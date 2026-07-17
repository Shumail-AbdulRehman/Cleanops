import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect, enter, fixture, backend, mockBilling, sql } from './fixtures';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.afterEach(async ({ page }) => { if (!page.isClosed()) await page.unrouteAll({ behavior: 'wait' }); });
async function fillSignup(page: Page, email: string) {
  await page.getByLabel('Your name', { exact: true }).fill('Synthetic owner');
  await page.getByLabel('Company name', { exact: true }).fill('S42 synthetic workspace');
  await page.getByLabel('Work email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
}
async function signIn(page: Page, who = 'ownerA', password = fixture.password) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.users[who].email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
for (const who of ['ownerA', 'managerA', 'unpaid', 'legacyOwner']) test(`S42-08-09-12-15 ${who} real unified sign-in survives reload`, async ({ page }) => {
  await signIn(page, who);
  await expect(page).toHaveURL(who === 'unpaid' || who === 'legacyOwner' ? /subscription\/recovery$/ : /dashboard$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toHaveCount(0);
  expect((await page.request.get(backend + '/api/common/get-current-user')).status()).toBe(200);
});
test('S42-02 pricing plan survives signup as a preselection', async ({ page }) => {
  await mockBilling(page); await page.goto('/pricing');
  await page.getByRole('link', { name: "Choose Starter", exact: true }).first().click();
  await expect(page).toHaveURL(/signup\?.*plan=STARTER/);
  await fillSignup(page, `s42-pricing-${randomUUID()}@example.invalid`); await page.getByRole('button', { name: 'Continue to plans' }).click();
  await expect(page.getByRole('radio', { name: /^Starter/ })).toBeChecked(); await page.reload();
  await expect(page.getByRole('radio', { name: /^Starter/ })).toBeChecked();
});
test('S42-03 tampered and repeated plan interval parameters are ignored', async ({ page }) => {
  await mockBilling(page); await enter(page, '/choose-plan?plan=BAD&interval=bad');
  await expect(page.getByRole('radio', { name: /^Starter/ })).toBeChecked();
  await page.goto('/subscription/payment?plan=PRO&plan=STARTER&interval=oops'); await expect(page).toHaveURL(/choose-plan$/);
});
for (const upper of [false, true]) test(`S42-04 duplicate signup ${upper ? 'different case' : 'exact'} leaves one account`, async ({ page }) => {
  const email = fixture.users.ownerA.email; await page.goto('/signup'); await fillSignup(page, upper ? email.toUpperCase() : email);
  await page.getByRole('button', { name: 'Continue to plans' }).click();
  await expect(page.getByRole('link', { name: 'Sign in instead', exact: true })).toBeVisible();
  expect((await sql('SELECT id FROM "Manager" WHERE lower(email)=lower($1)', [email])).length).toBe(1);
});
test('S42-05 missing fields and weak password keep typed values', async ({ page }) => {
  await page.goto('/signup'); await page.getByRole('button', { name: 'Continue to plans' }).click();
  await expect(page.getByRole('alert')).toHaveCount(4);
  await fillSignup(page, 'typed@example.invalid'); await page.getByLabel('Password', { exact: true }).fill('weak');
  await page.getByRole('button', { name: 'Continue to plans' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Work email', { exact: true })).toHaveValue('typed@example.invalid');
});
test('S42-06 double create account sends one request and creates one owner', async ({ page }) => {
  await mockBilling(page); const email = `s42-double-${randomUUID()}@example.invalid`; let posts = 0;
  await page.route('**/api/manager/manager-signup', async route => { posts++; await new Promise(resolve => setTimeout(resolve, 300)); await route.continue(); });
  await page.goto('/signup'); await fillSignup(page, email);
  await page.getByRole('button', { name: 'Continue to plans' }).dblclick();
  await expect(page.getByRole('heading', { name: 'Choose a plan', exact: true })).toBeVisible();
  expect(posts).toBe(1); expect((await sql('SELECT id FROM "Manager" WHERE email=$1', [email])).length).toBe(1);
});
test('S42-07 account persisted but session issuance fails offers sign-in', async ({ page }) => {
  const email = `s42-session-${randomUUID()}@example.invalid`;
  await page.route('**/api/manager/manager-signup', async route => {
    const response = await route.fetch(); const body = await response.json();
    expect(response.status()).toBe(201); body.data.sessionEstablished = false;
    await route.fulfill({ status: 201, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  });
  await page.goto('/signup'); await fillSignup(page, email); await page.getByRole('button', { name: 'Continue to plans' }).click();
  await expect(page.getByText('Your account is ready. Sign in to continue.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to plans' })).toHaveCount(0);
  expect((await sql('SELECT id FROM "Manager" WHERE email=$1', [email])).length).toBe(1);
});
for (const kind of ['unknown', 'wrong', 'deactivated', 'limited']) test(`S42-14 login ${kind} displays the correct message`, async ({ page }) => {
  if (kind === 'limited') await page.route('**/api/common/login', async route => {
    // Preserve the running API's exposure policy on the controlled 429. A
    // fulfilled response otherwise bypasses CORS middleware entirely.
    const response = await page.request.get(backend + '/api/support/contact', { headers: { Origin: new URL(page.url()).origin } });
    expect(response.ok()).toBe(true);
    const exposed = response.headers()['access-control-expose-headers'];
    await route.fulfill({ status: 429, headers: { 'retry-after': '17', ...(exposed ? { 'access-control-expose-headers': exposed } : {}) }, json: { message: 'Limited' } });
  });
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(kind === 'unknown' ? 'unknown@example.invalid' : fixture.users[kind === 'deactivated' ? 'deactivatedOwner' : 'ownerA'].email);
  await page.getByLabel('Password', { exact: true }).fill(kind === 'unknown' || kind === 'wrong' ? 'wrong-password' : fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(kind === 'limited' ? 'Too many attempts. Try again in 17 seconds.' : kind === 'deactivated' ? 'This account is deactivated.' : 'Email or password is incorrect.');
});
test('S42-16 forgot password gives a neutral result in FlowShell', async ({ page }) => {
  await page.route('**/api/owner-identity/recovery/request', route => route.fulfill({ json: { data: { accepted: true } } }));
  await page.goto('/login'); await page.getByRole('link', { name: 'Forgot password?', exact: true }).click();
  await page.getByLabel('Owner email', { exact: true }).fill('unknown@example.invalid'); await page.getByRole('button', { name: 'Request recovery link', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(/If|account/i); await expect(page.locator('.flow-shell')).toBeVisible();
});
for (const step of ['CHOOSE_PLAN', 'PAYMENT', 'CONFIRMING']) test(`S42-09-10-11 signed-in ${step} follows saved server facts after reload`, async ({ page }) => {
  const b = await mockBilling(page); b.facts.onboardingStep = step;
  if (step === 'PAYMENT') b.facts.checkoutResume = { plan: 'STARTER', interval: 'month', transactionId: b.transactionId };
  await enter(page, '/login'); await expect(page).toHaveURL(step === 'PAYMENT' ? /subscription\/payment$/ : step === 'CONFIRMING' ? /subscription\/activation$/ : /choose-plan$/);
  await page.reload(); await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toHaveCount(0);
  if (step === 'CONFIRMING') await expect(page.getByTitle('Controlled Paddle card form')).toHaveCount(0);
  expect(b.controls.posts).toBe(0);
});
for (const reason of ['BILLING_DISABLED', 'PRICE_NOT_READY', 'EMAIL_CONFLICT']) test(`S42-29-39-40 recovery ${reason} does not charge`, async ({ page }) => {
  const b = await mockBilling(page); b.facts.onboardingStep = reason === 'EMAIL_CONFLICT' ? 'RECONCILE' : 'UNAVAILABLE'; b.facts.recoveryReason = reason;
  b.controls.reconcile = reason === 'EMAIL_CONFLICT' ? 'CONFLICT' : 'UNRESOLVED';
  await enter(page, '/dashboard'); await expect(page.getByRole('heading', { name: reason === 'EMAIL_CONFLICT' ? 'This email is already used for payments' : 'Payments are unavailable right now', exact: true })).toBeVisible();
  await page.reload(); const support = await page.request.get(backend + '/api/support/contact'); expect(support.status()).toBe(200);expect((await support.json()).data.available).toBe(false);await expect(page.getByRole('link', { name: 'Contact support', exact: true })).toHaveCount(0); expect(b.controls.posts).toBe(0);
});
for (const outcome of ['CLEARED', 'RESUMABLE']) test(`S42-27-28-30-31 stuck reservation ${outcome} resolves automatically`, async ({ page }) => {
  const b = await mockBilling(page); b.facts.onboardingStep = 'RECONCILE'; b.facts.reconciliationRequired = true; b.controls.reconcile = outcome;
  await page.route('**/api/subscription/manage/checkout/reconcile', async route => {
    b.controls.reconciles++; b.facts.onboardingStep = outcome === 'RESUMABLE' ? 'PAYMENT' : 'CHOOSE_PLAN'; b.facts.reconciliationRequired = false;
    if (outcome === 'RESUMABLE') b.facts.checkoutResume = { plan: 'STARTER', interval: 'month', transactionId: b.transactionId };
    return route.fulfill({ json: { data: { outcome, lifecycle: await b.read() } } });
  });
  await enter(page, '/subscription/recovery'); await expect(page).toHaveURL(outcome === 'RESUMABLE' ? /subscription\/payment$/ : /choose-plan$/);
  await page.reload(); await expect(page.getByRole('heading', { name: outcome === 'RESUMABLE' ? 'Add your card' : 'Choose a plan', exact: true })).toBeVisible(); expect(b.controls.posts).toBe(0);
});
for (const timing of ['webhook-before', 'server-only', 'late-webhook']) test(`S42-32-33-34 ${timing} confirmation reaches Ready without duplicate`, async ({ page }) => {
  const b = await mockBilling(page); b.facts.onboardingStep = 'CONFIRMING'; await enter(page, '/subscription/activation');
  await expect(page.getByRole('heading', { name: 'Confirming your subscription', exact: true })).toBeVisible();
  b.facts.onboardingStep = 'WORKSPACE'; b.facts.workspaceAccessAllowed = true; b.controls.confirm = 'ACTIVE';
  await expect(page.getByRole('heading', { name: "You're all set", exact: true })).toBeVisible({ timeout: 10000 });
  await page.reload(); await expect(page.getByRole('heading', { name: "You're all set", exact: true })).toBeVisible({ timeout: 10000 }); expect(b.controls.posts).toBe(0);
});
test('S42-35 paid without subscription keeps waiting honestly', async ({ page }) => {
  const b = await mockBilling(page); b.facts.onboardingStep = 'CONFIRMING'; await enter(page, '/subscription/activation');
  await expect.poll(() => b.controls.confirms).toBeGreaterThan(0);
  await expect(page.getByRole('link', { name: 'Open your workspace', exact: true })).toHaveCount(0);
  await page.reload(); await expect(page.getByRole('heading', { name: 'Confirming your subscription', exact: true })).toBeVisible(); expect(b.controls.posts).toBe(0);
});
test('S42-36 confirmation deadline offers Check again without repayment', async ({ page }) => {
  const b = await mockBilling(page); b.facts.onboardingStep = 'CONFIRMING'; await page.clock.install(); await enter(page, '/subscription/activation');
  await expect(page.getByRole('heading', { name: 'Confirming your subscription', exact: true })).toBeVisible(); await page.clock.fastForward(121000);
  await expect(page.getByRole('button', { name: 'Check again', exact: true })).toBeVisible();
  b.facts.onboardingStep = 'WORKSPACE'; b.facts.workspaceAccessAllowed = true; b.controls.confirm = 'ACTIVE';
  await page.getByRole('button', { name: 'Check again', exact: true }).click(); await page.clock.runFor(2100);
  await expect(page.getByRole('heading', { name: "You're all set", exact: true })).toBeVisible(); expect(b.controls.posts).toBe(0);
});
test('S42-37 close paid tab then sign in later resumes confirmation', async ({ page, context }) => {
  const b = await mockBilling(page); b.facts.onboardingStep = 'CONFIRMING'; await enter(page, '/login');
  await expect(page).toHaveURL(/subscription\/activation$/); await page.close();
  const later = await context.newPage(); const next = await mockBilling(later); next.facts.onboardingStep = 'CONFIRMING';
  await later.goto('/login'); await expect(later).toHaveURL(/subscription\/activation$/);
  next.facts.onboardingStep = 'WORKSPACE'; next.facts.workspaceAccessAllowed = true; next.controls.confirm = 'ACTIVE';
  await expect(later.getByRole('heading', { name: "You're all set", exact: true })).toBeVisible({ timeout: 10000 });
});
test('S42-38 foreign provider facts never grant browser access', async ({ page }) => {
  const b = await mockBilling(page); b.facts.onboardingStep = 'CONFIRMING'; b.controls.confirm = 'ACTIVE';
  await page.route('**/api/subscription/manage/checkout/confirm', async route => { const data = await b.read(); data.company = { ...(data.company as object), id: fixture.company.B }; return route.fulfill({ json: { data: { outcome: 'ACTIVE', lifecycle: { ...data, workspaceAccessAllowed: true, onboardingStep: 'WORKSPACE' } } } }); });
  await enter(page, '/subscription/activation'); await expect(page.getByRole('heading', { name: 'Confirming your subscription', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open your workspace', exact: true })).toHaveCount(0);
});
test('S42-42 unpaid dashboard deep link has no operational navigation', async ({ page }) => {
  await mockBilling(page); await enter(page, '/dashboard'); await expect(page).toHaveURL(/choose-plan$/);
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toHaveCount(0); await page.reload(); await expect(page).toHaveURL(/choose-plan$/);
});
test('S42-44 manager billing URLs deny private data', async ({ page }) => {
  await enter(page, '/dashboard', 'managerA'); for (const path of ['/choose-plan', '/subscription/payment', '/subscription/activation', '/subscription/recovery']) {
    await page.goto(path); await expect(page.getByRole('radio')).toHaveCount(0); await expect(page.getByTitle('Controlled Paddle card form')).toHaveCount(0);
  }
  expect((await page.request.get(backend + '/api/subscription/manage/lifecycle')).status()).toBe(403);
});
test('S42-45 two tabs refresh a shared checkout session without sign-out', async ({ page, context }) => {
  const b = await mockBilling(page); await enter(page, '/subscription/payment?plan=STARTER&interval=month'); await expect(page.getByTitle('Controlled Paddle card form')).toBeVisible();
  const other = await context.newPage(); const c = await mockBilling(other); Object.assign(c.facts, b.facts);
  await other.goto('/subscription/payment'); await expect(other.getByTitle('Controlled Paddle card form')).toBeVisible();
  const access = (await context.cookies()).find(cookie => cookie.name === 'accessToken');
  expect(access).toBeDefined();
  await context.addCookies([{ ...access!, value: 'expired-isolated-access' }]);
  let refreshes = 0;
  context.on('request', request => { if (request.url().endsWith('/api/common/refresh-token')) refreshes++; });
  await Promise.all([page.reload(), other.reload()]);
  await expect.poll(() => refreshes).toBeGreaterThan(0);
  for (const tab of [page, other]) await expect(tab.getByTitle('Controlled Paddle card form')).toBeVisible(); expect(b.controls.posts + c.controls.posts).toBe(1);
});
test('S42-46 session 503 offers retry and preserves cookies', async ({ page }) => {
  await enter(page, '/dashboard'); await page.route('**/api/common/get-current-user', route => route.fulfill({ status: 503, json: { message: 'Unavailable' } }));
  await page.reload(); await expect(page.getByRole('button', { name: /Try again|Retry/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toHaveCount(0);
  await page.unroute('**/api/common/get-current-user'); await page.getByRole('button', { name: /Try again|Retry/i }).click(); await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
});
for (const width of [320, 390, 768, 1440]) test(`S42-48 ${width}px English Urdu reflow and full fixture footer`, async ({ page }) => {
  test.setTimeout(60000); const b = await mockBilling(page); await page.setViewportSize({ width, height: 900 }); await enter(page, '/choose-plan');
  for (const lang of ['en', 'ur']) for (const path of ['/choose-plan', '/subscription/payment?plan=STARTER&interval=month', '/subscription/activation', '/subscription/recovery']) {
    b.facts.onboardingStep = path.includes('activation') ? 'CONFIRMING' : path.includes('recovery') ? 'UNAVAILABLE' : path.includes('payment') ? 'PAYMENT' : 'CHOOSE_PLAN';
    if (path.includes('payment')) b.facts.checkoutResume = { plan: 'STARTER', interval: 'month', transactionId: b.transactionId };
    await page.goto(path); await page.getByRole('button', { name: lang === 'ur' ? 'اردو' : 'English', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (path.includes('payment')) { await expect(page.frameLocator('iframe').getByText('Paddle secure checkout · Terms · Privacy')).toBeVisible(); const box = await page.getByTitle('Controlled Paddle card form').boundingBox(); expect(box!.width).toBeLessThanOrEqual(width); }
  }
});
for (const lang of ['en', 'ur']) test(`S42-48a 1440px ${lang} plan values sit under their column headings`, async ({ page }) => {
  await mockBilling(page); await page.setViewportSize({ width: 1440, height: 900 }); await enter(page, '/choose-plan');
  await page.getByRole('button', { name: lang === 'ur' ? 'اردو' : 'English', exact: true }).click();
  await expect(page.locator('.flow-plan-row')).toHaveCount(3);
  const offsets = await page.evaluate(rtl => {
    const heads = [...document.querySelector('fieldset > div[aria-hidden="true"]')!.children].slice(1);
    return [...document.querySelectorAll('.flow-plan-row')].flatMap(row => {
      const values = [...row.querySelectorAll(':scope > span:nth-child(2) bdi'), row.querySelector('.flow-price')!];
      return values.map((value, index) => {
        const a = value.getBoundingClientRect(), b = heads[index].getBoundingClientRect();
        if (index < 3) return Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2);
        return rtl ? Math.abs(a.left - b.left) : Math.abs(a.right - b.right);
      });
    });
  }, lang === 'ur');
  expect(offsets).toHaveLength(12);
  for (const offset of offsets) expect(offset).toBeLessThanOrEqual(4);
});
for (const lang of ['en', 'ur']) test(`S42-48b 390px ${lang} sticky bar leaves the last plan tappable at phone heights`, async ({ page }) => {
  test.setTimeout(60000); await mockBilling(page); await page.setViewportSize({ width: 390, height: 844 }); await enter(page, '/choose-plan');
  await page.getByRole('button', { name: lang === 'ur' ? 'اردو' : 'English', exact: true }).click();
  const radio = page.locator('.flow-plan-row input').last(); await expect(radio).toBeEnabled();
  const covered: number[] = [];
  for (let height = 560; height <= 920; height += 20) {
    await page.setViewportSize({ width: 390, height }); await page.evaluate(() => scrollTo(0, 0));
    await radio.scrollIntoViewIfNeeded();
    if (!await radio.evaluate(el => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el; })) covered.push(height);
  }
  expect(covered).toEqual([]);
  await radio.click(); await expect(radio).toBeChecked();
});
test('S42-49 keyboard 200 percent zoom reduced motion reaches payment', async ({ page }) => {
  await mockBilling(page); await page.setViewportSize({ width: 1440, height: 900 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await enter(page, '/choose-plan');
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await page.getByRole('radio').first().focus(); await page.keyboard.press('ArrowDown'); await expect(page.getByRole('radio').nth(1)).toBeFocused();
  await page.getByRole('button', { name: 'Continue to payment' }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByTitle('Controlled Paddle card form')).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.evaluate(() => [...document.getAnimations()].filter(a => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity).length)).toBe(0);
});
test('S42-50 back forward follows saved server step without loop', async ({ page }) => {
  const b = await mockBilling(page); await enter(page, '/choose-plan'); await page.getByRole('button', { name: 'Continue to payment' }).click(); await expect(page.getByTitle('Controlled Paddle card form')).toBeVisible();
  await page.goBack(); await expect(page).toHaveURL(/subscription\/payment$/); await page.reload(); await expect(page.getByTitle('Controlled Paddle card form')).toBeVisible(); expect(b.controls.posts).toBe(1);
  await page.goForward(); await expect(page).toHaveURL(/subscription\/payment/);
  for (const [step, route] of [['CONFIRMING', '/subscription/activation'], ['WORKSPACE', '/dashboard'], ['RECONCILE', '/subscription/recovery'], ['UNAVAILABLE', '/subscription/recovery']]) {
    b.facts.onboardingStep = step; b.facts.workspaceAccessAllowed = step === 'WORKSPACE';
    await page.goto('/choose-plan'); await expect(page).toHaveURL(new RegExp(route + '$'));
    await page.goto('/features'); await page.goBack(); await expect(page).toHaveURL(new RegExp(route + '$'));
    await page.goForward(); await expect(page).toHaveURL(/features$/);
  }

});
test('S42-52 session expires on payment signs in to same draft', async ({ page }) => {
  const b = await mockBilling(page); await enter(page, '/subscription/payment?plan=STARTER&interval=month'); await expect(page.getByTitle('Controlled Paddle card form')).toBeVisible();
  await page.context().clearCookies(); await page.reload(); await expect(page).toHaveURL(/login/); await signIn(page);
  await expect(page).toHaveURL(/subscription\/payment$/); await expect(page.getByTitle('Controlled Paddle card form')).toBeVisible(); expect(b.controls.posts).toBe(1);
});
for (const path of ['/signup', '/login']) test(`S42-53 signed-in owner ${path} returns to current step`, async ({ page }) => {
  await mockBilling(page); await enter(page, path); await expect(page).toHaveURL(/choose-plan$/); await page.reload(); await expect(page).toHaveURL(/choose-plan$/);
});
test('S42-54 sign-in returns to safe requested page', async ({ page }) => {
  await page.goto('/settings'); await expect(page).toHaveURL(/login/);
  await page.getByLabel('Email', { exact: true }).fill(fixture.users.ownerA.email); await page.getByLabel('Password', { exact: true }).fill(fixture.password); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/settings$/); await page.reload(); await expect(page).toHaveURL(/settings$/);
});
test('S42-56 live unverified owner goes to verification without checkout', async ({ page }) => {
  const b = await mockBilling(page); b.facts.onboardingStep = 'VERIFY_EMAIL'; b.facts.billingEnvironment = 'production'; b.facts.checkoutAvailable = false;
  await enter(page, '/choose-plan'); await expect(page).toHaveURL(/account\/security$/); await page.reload(); await expect(page).toHaveURL(/account\/security$/); expect(b.controls.posts).toBe(0);
});

test('S42-14 rate limited without readable retry header has an explicit fallback', async ({ page }) => {
  await page.route('**/api/common/login', route => route.fulfill({ status: 429, json: { message: 'Limited' } }));
  await page.goto('/login'); await page.getByLabel('Email', { exact: true }).fill('limited@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-password'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Too many attempts. Try again in a few minutes.');
});
for (const [index, from] of ['https://evil.invalid/', '//evil.invalid/', '/login', '/subscription/payment'].entries()) test(`S42-54 unsafe return ${from} cannot redirect after sign-in`, async ({ page }) => {
  await page.addInitScript(value => { if (location.pathname === '/login') history.replaceState({ ...history.state, usr: { from: value } }, ''); }, from);
  await signIn(page, `ownerReturn${index}`); await expect(page).toHaveURL(/dashboard$/); await page.reload(); await expect(page).toHaveURL(/dashboard$/);
});

for (const [who, customerMode] of [['adoptOwner', 'adopt'], ['rejectOwner', 'rejectOnce'], ['conflictOwner', 'conflict']] as const) test(`S42-27-28-29 persisted customer ${customerMode} keeps a safe recovery path`, async ({ page }) => {
  const b = await mockBilling(page, { persisted: true, customerMode });
  try {
    await enter(page, '/subscription/payment?plan=STARTER&interval=month', who);
    if (customerMode !== 'adopt') {
      await expect(page.getByRole('button', { name: 'Check subscription status', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Check subscription status', exact: true }).click();
    }
    if (customerMode === 'conflict') {
      await expect(page.getByRole('heading', { name: 'This email is already used for payments', exact: true })).toBeVisible();
      expect((await sql('SELECT "billingCustomerId" FROM "Company" WHERE id=$1', [fixture.company[who]]))[0].billingCustomerId).toBeNull();
      expect(b.drafts).toHaveLength(0);
    } else {
      await expect(page.getByTitle('Controlled Paddle card form')).toBeVisible();
      expect((await sql('SELECT id FROM "AuditLog" WHERE "companyId"=$1 AND action=\'CUSTOMER_CREATE_READY\'', [fixture.company[who]])).length).toBe(1);
      await page.reload(); await expect(page.getByTitle('Controlled Paddle card form')).toBeVisible();
      expect(b.drafts).toHaveLength(1);
    }
  } finally { await page.unrouteAll({ behavior: 'wait' }); await b.dispose(); }
});
