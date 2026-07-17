import { randomUUID } from 'node:crypto';
import { test, expect, fixture, mockBilling, sql } from './fixtures';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('S42-01 new owner signup controlled 4242 ready dashboard and persisted account', async ({ page }) => {
  const b = await mockBilling(page, { persisted: true }); const email = `s42-${randomUUID()}@example.invalid`;
  try {
  await page.goto('/signup');
  await page.getByLabel('Your name', { exact: true }).fill('Synthetic owner');
  await page.getByLabel('Company name', { exact: true }).fill('Synthetic workspace');
  await page.getByLabel('Work email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Continue to plans' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a plan', exact: true })).toBeVisible();
  const [owner] = await sql('SELECT id,"companyId" FROM "Manager" WHERE email=$1', [email]);
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await page.frameLocator('iframe').getByRole('button', { name: 'Pay 4242' }).click();
  await expect(page.getByRole('heading', { name: 'Confirming your subscription', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open your workspace', exact: true })).toHaveCount(0);
  b.controls.confirm = 'ACTIVE';
  await expect(page.getByRole('heading', { name: "You're all set", exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByRole('link', { name: 'Open your workspace', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible(); await page.reload();
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
  expect(await sql('SELECT id,"companyId" FROM "Manager" WHERE email=$1', [email])).toEqual([owner]);
  expect(b.controls.posts).toBe(1); expect(b.drafts).toHaveLength(1);
  expect((await sql('SELECT id FROM "PaddleSubscription" WHERE "companyId"=$1 AND status=\'active\'', [owner.companyId])).length).toBe(1);
  expect((await sql('SELECT id FROM "AuditLog" WHERE "companyId"=$1 AND action=\'CHECKOUT_READY\'', [owner.companyId])).length).toBe(1);
  await page.unrouteAll({ behavior: 'wait' }); await page.reload();
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
  } finally { await b.dispose(); }
});
// These are controlled checkout events, never real Paddle processing or signed delivery.
