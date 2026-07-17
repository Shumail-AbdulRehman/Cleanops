import { test, expect, enter, mockBilling } from './fixtures';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'wait' }); });
for (const catalog of ['error', 'empty', 'partial']) test(`S42 catalog ${catalog} refuses an unavailable selection and retries`, async ({ page }) => {
  const b = await mockBilling(page); b.controls.catalog = catalog;
  await enter(page, '/choose-plan');
  await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeDisabled();
  await expect(page.getByText(catalog === 'error' ? 'Prices could not load.' : 'No plans are available for this billing interval.', { exact: true }).first()).toBeVisible();
  b.controls.catalog = 'ok'; await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('radio')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeEnabled();
});
for (const kind of ['fail', 'throw']) test(`S42-17 ${kind} Paddle script/open failure retries with at most one draft`, async ({ page }) => {
  const b = await mockBilling(page); b.controls.sdk = kind;
  await enter(page, '/subscription/payment?plan=PRO&interval=year');
  await expect(page.getByRole('heading', { name: "The card form didn't load" })).toBeVisible();
  expect(b.controls.posts).toBe(kind === 'fail' ? 0 : 1);
  b.controls.sdk = 'ok'; await page.evaluate(() => { (window as unknown as { billingThrow: boolean }).billingThrow = false; });
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByTitle('Controlled Paddle card form')).toBeVisible();
  expect(b.controls.posts).toBe(1);
});
test('S42-18 checkout.loaded watchdog retries the same draft', async ({ page }) => {
  const b = await mockBilling(page); b.controls.loaded = false;
  await page.clock.install(); await enter(page, '/subscription/payment?plan=STARTER&interval=month');
  await expect(page.getByTitle('Controlled Paddle card form')).toBeAttached();
  await page.clock.fastForward(21000);
  await expect(page.getByRole('heading', { name: "The card form didn't load" })).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await b.emit('checkout.loaded'); await expect(page.getByRole('link', { name: 'Change plan', exact: true })).toBeVisible();
  expect(b.controls.posts).toBe(1);
});
test('S42-19 declined then valid card keeps the frame and draft', async ({ page }) => {
  const b = await mockBilling(page); await enter(page, '/subscription/payment?plan=STARTER&interval=month');
  const frame = page.frameLocator('iframe'); await frame.getByLabel('Cardholder name').fill('Synthetic entry');
  await frame.getByRole('button', { name: 'Decline', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('That card was declined.');
  await expect(frame.getByLabel('Cardholder name')).toHaveValue('Synthetic entry');
  await frame.getByRole('button', { name: 'Pay 4242' }).click();
  await expect(page.getByRole('heading', { name: 'Confirming your subscription', exact: true })).toBeVisible();
  expect(b.controls.posts).toBe(1);
});
test('S42-20 3D Secure challenge keeps the same inline form', async ({ page }) => {
  const b = await mockBilling(page); await enter(page, '/subscription/payment?plan=STARTER&interval=month');
  const frame = page.frameLocator('iframe'); await frame.getByLabel('Cardholder name').fill('Challenge entry');
  await frame.getByRole('button', { name: '3D Secure' }).click();
  await expect(page.getByText('Processing your payment. Please keep this page open.', { exact: true })).toBeVisible();
  await expect(frame.getByLabel('Cardholder name')).toHaveValue('Challenge entry');
  await frame.getByRole('button', { name: 'Approve bank challenge' }).click();
  await expect(page.getByRole('heading', { name: 'Confirming your subscription', exact: true })).toBeVisible(); expect(b.drafts).toHaveLength(1);
});
test('S42-21 flat no payment methods error offers retry instead of decline', async ({ page }) => {
  const b = await mockBilling(page); b.controls.loaded = false; await enter(page, '/subscription/payment?plan=STARTER&interval=month');
  await expect(page.getByTitle('Controlled Paddle card form')).toBeAttached(); await b.emit('checkout.error', true);
  await expect(page.getByRole('heading', { name: "The card form didn't load" })).toBeVisible();
  await expect(page.getByText('That card was declined.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again', exact: true }).click(); await b.emit('checkout.loaded'); await expect(page.getByTitle('Controlled Paddle card form')).toBeVisible(); expect(b.controls.posts).toBe(1);
});
test('S42-22 reload payment restores the saved draft despite tampered selection', async ({ page }) => {
  const b = await mockBilling(page); await enter(page, '/subscription/payment?plan=PRO&interval=year');
  await expect(page.getByTitle('Controlled Paddle card form')).toBeVisible(); await page.reload();
  await expect(page.getByTitle('Controlled Paddle card form')).toBeVisible();
  await page.goto('/subscription/payment?plan=BAD&interval=bad'); await expect(page.getByTitle('Controlled Paddle card form')).toBeVisible();
  expect(b.controls.posts).toBe(1); expect(b.drafts[0]).toMatchObject({ plan: 'PRO', interval: 'year', status: 'draft' });
});
test('S42-23 rapid navigation and double mount reuse the existing draft', async ({ page }) => {
  const b = await mockBilling(page); await enter(page, '/subscription/payment?plan=STARTER&interval=month');
  await expect(page.getByTitle('Controlled Paddle card form')).toBeVisible();
  for (let i = 0; i < 2; i++) { await page.getByRole('link', { name: 'Change plan', exact: true }).click(); await page.goBack(); await expect(page.getByTitle('Controlled Paddle card form')).toBeVisible(); }
  expect(b.controls.posts).toBe(1);
});
test('S42-24 change plan before paying cancels the old draft', async ({ page }) => {
  const b = await mockBilling(page); await enter(page, '/subscription/payment?plan=STARTER&interval=month');
  await expect(page.getByTitle('Controlled Paddle card form')).toBeVisible(); await page.getByRole('link', { name: 'Change plan', exact: true }).click();
  await page.getByRole('radio', { name: /^Pro/ }).check(); await page.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(page.getByRole('complementary', { name: 'Order summary' }).getByText('Pro', { exact: true })).toBeVisible();
  await expect(page.getByTitle('Controlled Paddle card form')).toBeVisible();
  expect(b.drafts.map(d => d.status)).toEqual(['canceled', 'draft']); expect(b.controls.posts).toBe(2);
  expect(b.drafts[1]).toMatchObject({ plan: 'PRO', interval: 'month' });
  await page.reload(); await expect(page.getByTitle('Controlled Paddle card form')).toBeVisible();
  await page.goBack(); await expect(page.getByRole('heading', { name: 'Choose a plan', exact: true })).toBeVisible();
  await page.goForward(); await expect(page.getByTitle('Controlled Paddle card form')).toBeVisible();
  expect(b.drafts.map(d => d.status)).toEqual(['canceled', 'draft']); expect(b.controls.posts).toBe(2);
});
test('S42-25 another tab paid before changing plan goes to confirming', async ({ page }) => {
  const b = await mockBilling(page); await enter(page, '/subscription/payment?plan=STARTER&interval=month');
  await expect(page.getByTitle('Controlled Paddle card form')).toBeVisible();
  b.drafts[0].status = 'paid'; b.facts.onboardingStep = 'CONFIRMING'; b.facts.checkoutResume = null;
  await page.getByRole('link', { name: 'Change plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirming your subscription', exact: true })).toBeVisible(); expect(b.controls.posts).toBe(1);
});
test('S42-26 prepare response lost after sending never sends a second POST', async ({ page }) => {
  const b = await mockBilling(page); b.controls.checkout = 'lost'; await enter(page, '/subscription/payment?plan=STARTER&interval=month');
  await expect(page.getByText('We could not confirm your previous checkout. Check again before making another payment.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check subscription status', exact: true }).click();
  await expect(page.getByTitle('Controlled Paddle card form')).toBeVisible(); await page.reload();
  await expect(page.getByTitle('Controlled Paddle card form')).toBeVisible(); expect(b.controls.posts).toBe(1);
});
test('S42-47 offline during payment recovers without losing entry', async ({ page }) => {
  const b = await mockBilling(page); await enter(page, '/subscription/payment?plan=STARTER&interval=month');
  const input = page.frameLocator('iframe').getByLabel('Cardholder name'); await input.fill('Offline entry');
  await page.context().setOffline(true); await expect(page.getByText("You're offline. Reconnect to continue. Your details stay here.", { exact: true })).toBeVisible();
  await page.context().setOffline(false); await expect(input).toHaveValue('Offline entry'); expect(b.controls.posts).toBe(1);
});
test('S42-51 language change preserves card entry and frame identity', async ({ page }) => {
  const b = await mockBilling(page); await enter(page, '/subscription/payment?plan=STARTER&interval=month');
  const input = page.frameLocator('iframe').getByLabel('Cardholder name'); await input.fill('Retained entry');
  await page.getByRole('button', { name: 'اردو', exact: true }).click(); await expect(input).toHaveValue('Retained entry');
  await page.getByRole('button', { name: 'English', exact: true }).click(); await expect(input).toHaveValue('Retained entry');
  expect(await page.evaluate(() => (window as unknown as { billingOpens: number }).billingOpens)).toBe(1); expect(b.controls.posts).toBe(1);
});
