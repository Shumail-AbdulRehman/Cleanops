import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Page } from '@playwright/test';
import { backend, expect, fixture, login, sql, test } from './fixtures';

const run = promisify(execFile);
const web = process.env.HYGENE_E2E_WEB_ORIGIN!;
const companyName = 'E2E company A';
const companyLink = 'Open ' + companyName;
const companyPath = () => `/platform/companies/${fixture.company.A}`;
const subscriptionId = 'sub_00000000000000000000000001';
const recentInvoice = 'E2E-INVOICE-RECENT';
const earlierInvoice = 'E2E-INVOICE-EARLIER';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.HYGENE_E2E_LOCAL_PLATFORM !== 'true', 'Explicit isolated local-platform mode is required');

test.beforeEach(async ({ context }) => {
  await context.route(/^https?:\/\//, route =>
    [web, backend].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort(),
  );
});

function operatorCredentials() {
  return JSON.parse(readFileSync(process.env.HYGENE_E2E_PLATFORM_OWNER_FILE!, 'utf8')) as {
    email: string;
    password: string;
  };
}

async function openConsole(page: Page, path: string) {
  const response = await page.request.post(backend + '/api/platform/session/login', {
    headers: { Origin: web },
    data: operatorCredentials(),
  });
  expect(response.status()).toBe(200);
  await page.goto(path);
}

async function makePastDue() {
  await sql(`UPDATE "PaddleSubscription" s SET status = 'past_due'
    FROM "Company" c WHERE s.id = c."billingSubscriptionId" AND c.id = $1`, [fixture.company.A]);
}

async function addPayments() {
  await sql(`INSERT INTO "PaddleTransaction"
    (id, "companyId", status, "currencyCode", total, "invoiceNumber", "paddleCreatedAt", "paddleUpdatedAt", "lastEventAt", "updatedAt")
    VALUES
      ('txn_00000000000000000000000001', $1, 'completed', 'USD', '12500', $2, NOW(), NOW(), NOW(), NOW()),
      ('txn_00000000000000000000000002', $1, 'completed', 'USD', '7500', $3, NOW() - INTERVAL '4 months', NOW(), NOW(), NOW())`,
    [fixture.company.A, recentInvoice, earlierInvoice]);
}

test('local operator sign-in lands on Overview with all four rail links', async ({ page }) => {
  const { email, password } = operatorCredentials();
  await page.goto('/platform/login');
  await page.getByLabel('Platform email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in to platform', exact: true }).click();
  await expect(page).toHaveURL(/\/platform\/overview$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link'))
    .toHaveText(['Overview', 'Companies', 'Subscriptions', 'Inquiries']);
});

test('Overview company, paying and past-due figures agree with SQL', async ({ page }) => {
  await makePastDue();
  await sql(`UPDATE "PaddleSubscription" SET status = 'canceled' WHERE "companyId" = $1`, [fixture.company.B]);
  await sql(`INSERT INTO "Company" (name, "updatedAt") VALUES ('E2E company without subscription', NOW())`);
  const [counts] = await sql(`SELECT COUNT(*)::int AS companies,
    COUNT(*) FILTER (WHERE s.status IN ('active', 'trialing', 'past_due'))::int AS paying,
    COUNT(*) FILTER (WHERE s.status = 'past_due')::int AS past_due
    FROM "Company" c LEFT JOIN "PaddleSubscription" s ON s.id = c."billingSubscriptionId"`);
  expect(counts.companies).toBeGreaterThan(counts.paying);
  expect(counts.past_due).toBeGreaterThan(0);

  await openConsole(page, '/platform/overview');
  const figures = page.getByRole('region', { name: 'Overview figures' });
  for (const [heading, count] of [
    ['Companies', counts.companies],
    ['Paying companies', counts.paying],
    ['Past due', counts.past_due],
  ]) {
    const tile = figures.getByRole('article').filter({ has: page.getByRole('heading', { name: heading, exact: true }) });
    await expect(tile.getByText(String(count), { exact: true })).toBeVisible();
  }
});

test('Overview attention opens the past-due company', async ({ page }) => {
  await makePastDue();
  await openConsole(page, '/platform/overview');
  const attention = page.getByRole('region', { name: 'Needs attention' });
  await expect(attention.getByText(/Payment past due/)).toBeVisible();
  await attention.getByRole('link', { name: companyLink, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${companyPath()}$`));
  await expect(page.getByRole('heading', { level: 1, name: companyName })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Usage against plan' })).toBeVisible();
});

test('Overview revenue mode and table survive reload', async ({ page }) => {
  await openConsole(page, '/platform/overview');
  const revenue = page.getByRole('region', { name: 'Revenue', exact: true });
  const recurring = revenue.getByRole('button', { name: 'Recurring', exact: true });
  const collected = revenue.getByRole('button', { name: 'Collected', exact: true });
  await expect(recurring).toHaveAttribute('aria-pressed', 'true');
  await collected.click();
  await revenue.getByRole('button', { name: 'Table for Revenue' }).click();
  const table = revenue.getByRole('table', { name: 'Collected payments' });
  await expect(table.getByRole('row')).toHaveCount(13);
  await expect(table.getByRole('rowheader', { name: /so far/ })).toBeVisible();
  const rows = await table.getByRole('row').allTextContents();
  await expect(page).toHaveURL(/revenue=collected.*revenueView=table/);
  await page.reload();
  await expect(collected).toHaveAttribute('aria-pressed', 'true');
  await expect(table.getByRole('row')).toHaveText(rows);
});

test('Overview subscription status link applies the Companies past-due filter', async ({ page }) => {
  await makePastDue();
  await openConsole(page, '/platform/overview');
  const status = page.getByRole('list', { name: 'Subscription states' });
  await status.getByRole('link', { name: /^Past due \d+$/ }).click();
  await expect(page).toHaveURL(/\/platform\/companies\?subscription=PAST_DUE$/);
  await expect(page.getByRole('button', { name: 'Subscription: Past due' })).toBeVisible();
  const results = page.getByRole('region', { name: 'Company results' });
  await expect(results.getByRole('link', { name: /^Open E2E company/ })).toHaveText([companyName]);
});

test('Companies search and filters drive URL and cursor page results', async ({ page }) => {
  await sql(`INSERT INTO "Company" (name, plan, "operationalStatus", "updatedAt")
    SELECT 'E2E Directory ' || lpad(n::text, 2, '0'), 'PRO', 'SUSPENDED', NOW()
    FROM generate_series(1, 27) n`);
  await sql(`INSERT INTO "Company" (name, plan, "operationalStatus", "updatedAt")
    VALUES ('E2E Directory Starter', 'STARTER', 'SUSPENDED', NOW()),
           ('E2E Directory Active', 'PRO', 'ACTIVE', NOW())`);

  await openConsole(page, '/platform/companies');
  await page.getByRole('searchbox', { name: 'Search companies' }).fill('E2E Directory');
  for (const [trigger, choice] of [
    ['Plan: All plans', 'Pro'],
    ['Subscription: Any subscription', 'Never paid'],
    ['Account status: Any account status', 'Suspended'],
  ]) {
    await page.getByRole('button', { name: trigger, exact: true }).click();
    await page.getByRole('menuitemradio', { name: choice, exact: true }).click();
  }
  const results = page.getByRole('region', { name: 'Company results' });
  const links = results.getByRole('link', { name: /^Open E2E Directory/ });
  await expect(links).toHaveCount(25);
  const firstPage = await links.allTextContents();
  expect(firstPage.every(name => /^E2E Directory \d{2}$/.test(name))).toBe(true);
  const filters = new URL(page.url()).searchParams;
  expect(Object.fromEntries(filters)).toEqual({
    q: 'E2E Directory', plan: 'PRO', subscription: 'NONE', status: 'SUSPENDED',
  });
  await results.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page).toHaveURL(/[?&]after=/);
  await expect(links).toHaveCount(2);
  expect([...firstPage, ...await links.allTextContents()].sort()).toEqual(
    Array.from({ length: 27 }, (_, i) => `E2E Directory ${String(i + 1).padStart(2, '0')}`),
  );
  await page.reload();
  await expect(links).toHaveCount(2);
  await results.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(links).toHaveText(firstPage);
});

test('Company page shows usage, activity, quality and payment records without an owner phone row', async ({ page }) => {
  await addPayments();
  await openConsole(page, companyPath());
  await expect(page.getByRole('heading', { level: 1, name: companyName })).toBeVisible();
  const usage = page.getByRole('region', { name: 'Usage against plan' });
  for (const label of ['Locations', 'Staff', 'Managers']) {
    await expect(usage.getByRole('meter', { name: label })).toBeVisible();
  }
  const activity = page.getByRole('region', { name: 'Activity', exact: true });
  await activity.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(activity.getByRole('table').getByRole('row')).toHaveCount(31);
  await expect(page.getByRole('region', { name: 'Work quality' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Payments', exact: true }).getByText(recentInvoice)).toBeVisible();
  const account = page.getByRole('region', { name: 'Account', exact: true });
  await expect(account.getByText(fixture.users.ownerA.email)).toBeVisible();
  await expect(account.getByText(/phone/i)).toHaveCount(0);
});

test('Suspension blocks tenant records and reactivation restores access with audit history', async ({ page, browser }) => {
  const tenant = await browser.newContext();
  try {
    await login(tenant.request, 'ownerA');
    const records = () => tenant.request.get(backend + '/api/staff/');
    expect((await records()).status()).toBe(200);
    await openConsole(page, companyPath());
    const history = page.getByRole('region', { name: 'Platform history' });
    const suspendReason = 'E2E operator paused this account';
    const reactivateReason = 'E2E operator restored this account';

    await page.getByRole('button', { name: 'Suspend company', exact: true }).click();
    const suspend = page.getByRole('dialog', { name: `Suspend ${companyName}?` });
    await expect(suspend.getByRole('button', { name: 'Suspend company' })).toBeDisabled();
    await suspend.getByRole('textbox', { name: 'Reason' }).fill(suspendReason);
    await suspend.getByRole('button', { name: 'Suspend company' }).click();
    const banner = page.getByRole('region', { name: /^Account suspended/ });
    await expect(banner.getByText(suspendReason)).toBeVisible();
    await expect(history.getByText(suspendReason)).toBeVisible();
    expect((await records()).status()).toBe(403);

    await banner.getByRole('button', { name: 'Reactivate' }).click();
    const reactivate = page.getByRole('dialog', { name: `Reactivate ${companyName}?` });
    await reactivate.getByRole('textbox', { name: 'Reason' }).fill(reactivateReason);
    await reactivate.getByRole('button', { name: 'Reactivate' }).click();
    await expect(banner).toHaveCount(0);
    await expect(history.getByText(reactivateReason)).toBeVisible();
    expect((await records()).status()).toBe(200);

    const audit = await sql(`SELECT action, reason FROM "AuditLog"
      WHERE "companyId" = $1 AND "entityType" = 'COMPANY_ACCOUNT' AND "actorType" = 'PLATFORM_OPERATOR'
      ORDER BY id`, [fixture.company.A]);
    expect(audit).toEqual([
      { action: 'COMPANY_SUSPENDED', reason: suspendReason },
      { action: 'COMPANY_REACTIVATED', reason: reactivateReason },
    ]);
    await page.reload();
    await expect(history.getByText(reactivateReason)).toBeVisible();
    await expect(history.getByText(suspendReason)).toBeVisible();
  } finally {
    await tenant.close();
  }
});

test('Subscriptions tab filters status and offers only read-only Paddle links', async ({ page }) => {
  await makePastDue();
  await sql(`WITH mirror AS (
    UPDATE "PaddleSubscription" SET id = $1 WHERE "companyId" = $2 RETURNING id
  ) UPDATE "Company" SET "billingSubscriptionId" = mirror.id FROM mirror WHERE "Company".id = $2`,
    [subscriptionId, fixture.company.A]);
  await openConsole(page, '/platform/subscriptions');
  const main = page.getByRole('main');
  const chip = main.getByRole('group', { name: 'Subscription status' }).getByRole('button', { name: /^Past due/ });
  await expect(main.getByRole('link', { name: 'E2E company B', exact: true })).toBeVisible();
  await chip.click();
  await expect(page).toHaveURL(/\?status=PAST_DUE$/);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(main.getByRole('link', { name: 'E2E company B', exact: true })).toHaveCount(0);
  await expect(main.getByRole('link', { name: companyName, exact: true })).toBeVisible();
  const paddle = main.getByRole('link', { name: `Open in Paddle for ${companyName}` });
  await expect(paddle).toBeVisible();
  await expect(paddle).toHaveAttribute('href', new RegExp(`/subscriptions-v2/${subscriptionId}$`));
  const billingActions = /^(cancel|pause|resume|refund|credit|change plan|update billing)\b/i;
  await expect(main.getByRole('button', { name: billingActions })).toHaveCount(0);
  await expect(main.getByRole('row').getByRole('link', { name: billingActions })).toHaveCount(0);
});

test('Payments tab updates the collected total and rows when the period changes', async ({ page }) => {
  await addPayments();
  await openConsole(page, '/platform/subscriptions');
  await page.getByRole('navigation', { name: 'Billing' }).getByRole('link', { name: 'Payments' }).click();
  await expect(page).toHaveURL(/\/platform\/subscriptions\/payments$/);
  const period = page.getByRole('group', { name: 'Payment period' });
  await expect(page.getByText('Collected $125 · 1 payment', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: recentInvoice })).toBeVisible();
  await expect(page.getByRole('cell', { name: earlierInvoice })).toHaveCount(0);
  await period.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page).toHaveURL(/\?range=all$/);
  await expect(page.getByText('Collected $200 · 2 payments', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: earlierInvoice })).toBeVisible();
});

test('Inquiry status needs a note and persists after reload', async ({ page }) => {
  const id = randomUUID();
  const company = 'E2E enterprise prospect';
  await sql(`INSERT INTO "EnterpriseInquiry" (id, name, email, company, locations, staff, requirements)
    VALUES ($1, 'E2E prospect', 'prospect@example.invalid', $2, 21, 210, 'Request a multi-location quote')`, [id, company]);
  await openConsole(page, '/platform/inquiries');
  await page.getByRole('button', { name: new RegExp(company) }).click();
  await expect(page).toHaveURL(new RegExp(`inquiry=${id}$`));
  const details = page.getByRole('region', { name: 'Inquiry details' });
  const progress = details.getByRole('radio', { name: 'In progress' });
  const save = details.getByRole('button', { name: 'Save status' });
  await expect(details.getByRole('radio', { name: 'New', exact: true })).toBeChecked();
  await progress.check();
  await expect(save).toBeDisabled();
  await details.getByRole('textbox', { name: 'Note' }).fill('   ');
  await expect(save).toBeDisabled();
  await details.getByRole('textbox', { name: 'Note' }).fill('E2E note: follow up with the prospect');
  await save.click();
  await expect(details.getByRole('status')).toHaveText('Inquiry updated.');
  await page.reload();
  await expect(progress).toBeChecked();
  await expect(page.getByRole('button', { name: /E2E enterprise prospect.*In progress/ })).toBeVisible();
});

test('Tenant identity receives 401 on every new console API', async ({ context: { request } }) => {
  await login(request, 'ownerA');
  expect((await request.get(backend + '/api/common/get-current-user')).status()).toBe(200);
  for (const path of [
    '/platform/overview',
    '/platform/companies',
    `${companyPath()}/insights`,
    '/platform/subscriptions',
    '/platform/payments',
  ]) {
    const response = await request.get(backend + '/api' + path);
    expect(response.status(), path).toBe(401);
  }
});

const phonePages = [
  { view: 'Overview', path: '/platform/overview', title: 'Overview', content: 'Overview figures' },
  { view: 'Companies', path: '/platform/companies', title: 'Companies', content: companyLink },
  { view: 'Company detail', path: companyPath(), title: companyName, content: 'Usage against plan' },
  { view: 'Subscriptions', path: '/platform/subscriptions', title: 'Subscriptions', content: 'Recurring revenue by plan' },
  { view: 'Payments', path: '/platform/subscriptions/payments', title: 'Subscriptions', content: 'Collected per week' },
  { view: 'Inquiries', path: '/platform/inquiries', title: 'Inquiries', content: 'No inquiries yet.' },
] as const;

for (const { view, path, title, content } of phonePages) {
  test(`${view} fits at 390px and the phone drawer opens and closes`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await openConsole(page, path);
    await expect(page.getByRole('banner').getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
    await expect(
      page.getByRole('region', { name: content, exact: true })
        .or(page.getByRole('link', { name: content, exact: true }))
        .or(page.getByText(content, { exact: true })).first(),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const menu = page.getByRole('button', { name: 'Open menu' });
    const rail = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(rail).toHaveCount(0);
    await menu.click();
    await expect(rail.getByRole('link')).toHaveText(['Overview', 'Companies', 'Subscriptions', 'Inquiries']);
    await page.keyboard.press('Escape');
    await expect(rail).toHaveCount(0);
    await expect(menu).toBeFocused();

    await menu.click();
    await rail.getByRole('link', { name: 'Overview', exact: true }).click();
    await expect(page).toHaveURL(/\/platform$/);
    await expect(rail).toHaveCount(0);
  });
}

const catalog = ['STARTER', 'PRO', 'ADVANCED'].map((plan, i) => ({
  plan, interval: 'month', priceId: `pri_${String(i + 1).padStart(26, '0')}`,
}));

function seedDemo(database: string) {
  const backendDir = fileURLToPath(new URL('../../backend/', import.meta.url));
  const env = {
    PATH: process.env.PATH,
    NODE_ENV: 'development',
    DOTENV_CONFIG_PATH: '/dev/null',
    PADDLE_ENVIRONMENT: 'sandbox',
    PADDLE_PRICE_CATALOG_JSON: JSON.stringify(catalog),
    PADDLE_BILLING_ENABLED: 'false',
  };
  return run(process.execPath, [
    join(backendDir, 'node_modules/tsx/dist/cli.mjs'),
    join(backendDir, 'scripts/platformDemoSeed.ts'), '--apply',
  ], { cwd: process.env.HYGENE_E2E_RUNTIME_DIR, env: { ...env, DATABASE_URL: database } });
}

test('Demo seed guard rejects an unapproved database URL', async () => {
  await expect(seedDemo('postgresql://none:none@127.0.0.1:1/none')).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining('Set DATABASE_URL to the allowed loopback demo or disposable database.'),
  });
});

test('Demo seed uses the configured price ID for each plan in persisted subscription mirrors', async () => {
  test.setTimeout(90_000);
  // sql() validates the harness-managed child before the script may use its URL.
  await sql('SELECT 1');
  await seedDemo(process.env.HYGENE_E2E_DATABASE_URL!);
  const prices = await sql(`SELECT c.plan, s."priceId", COUNT(*)::int AS count
    FROM "Company" c JOIN "PaddleSubscription" s ON c."billingSubscriptionId" = s.id
    WHERE c.name LIKE 'Platform Demo 28 - %' GROUP BY c.plan, s."priceId"`);
  expect(prices).toHaveLength(catalog.length);
  for (const { plan, priceId } of catalog) {
    expect(prices).toContainEqual({ plan, priceId, count: expect.any(Number) });
  }
});
