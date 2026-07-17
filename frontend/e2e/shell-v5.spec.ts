import { test, expect, enter, backend, fixture } from './fixtures';
import { copy, noOverflow } from './workspace-helpers';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('workspace owner and manager rail, company name and review badge in English Urdu desktop phone', async ({ browser }) => {
  test.setTimeout(90000);
  for (const who of ['ownerA', 'managerA']) for (const width of [1366, 390]) for (const lang of ['en', 'ur']) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      const page = await context.newPage();
      await enter(page, '/today-status', who, lang);
      await expect(page.getByRole('heading', { name: copy('Today, at a glance', lang), exact: true })).toBeVisible();
      const trigger = page.getByRole('button', { name: copy('Open navigation', lang), exact: true });
      if (width === 390) await trigger.click();
      const rail = width === 390 ? page.getByRole('dialog', { name: copy('Workspace menu', lang) }) : page.getByRole('complementary');
      await expect(rail.getByText('E2E company A', { exact: true })).toBeVisible();
      const nav = rail.getByRole('navigation', { name: copy('Workspace navigation', lang) });
      await expect(nav.getByRole('link', { name: copy('Today', lang), exact: true })).toHaveAttribute('aria-current', 'page');
      for (const label of ['Overview', 'Attendance', 'Locations', 'Team', 'Settings']) await expect(nav.getByRole('link', { name: copy(label, lang), exact: true })).toBeVisible();
      for (const label of ['Managers', 'Company setup', 'Plan & billing']) await expect(nav.getByRole('link', { name: copy(label, lang), exact: true })).toHaveCount(who === 'ownerA' ? 1 : 0);
      const response = await page.request.get(backend + '/api/verification-exceptions/count?queue=needs-me');
      expect(response.status()).toBe(200);
      const count: number = (await response.json()).data.total;
      expect(count).toBeGreaterThan(0);
      const reviews = nav.getByRole('link', { name: new RegExp(copy('Photo Reviews', lang)) });
      await expect(reviews).toContainText(count.toLocaleString(lang === 'ur' ? 'ur-PK' : 'en-PK'));
      await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ur' ? 'rtl' : 'ltr');
      await noOverflow(page);
      if (width === 390) {
        await page.keyboard.press('Escape');
        await expect(rail).toHaveCount(0); await expect(trigger).toBeFocused();
        await trigger.click();
      }
      await nav.getByRole('link', { name: copy('Team', lang), exact: true }).click();
      await expect(page).toHaveURL(/\/staff$/);
      await expect(page.getByRole('heading', { name: copy('Your people, at a glance', lang), exact: true })).toBeVisible();
      if (width === 390) await expect(rail).toHaveCount(0);
      await noOverflow(page);
    } finally { await context.close(); }
  }
});

test('shell preserves manager denial, staff handoff, localized dialogs and not-found recovery', async ({ page }) => {
  await enter(page, '/settings', 'managerA'); await expect(page).toHaveURL(/\/dashboard$/);
  expect((await page.request.get(backend + '/api/company/settings')).status()).toBe(403);
  await page.goto('/account/security'); await expect(page.getByLabel('Current password', { exact: true })).toBeVisible();
  await enter(page, '/staff', 'transfer'); await expect(page.getByRole('heading', { name: 'Your work is in the app' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toHaveCount(0);
  await enter(page, `/staff/${fixture.staff.transfer.id}`, 'ownerA', 'ur');
  await page.getByRole('button', { name: copy('Staff access', 'ur'), exact: true }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: copy('Close', 'ur'), exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await enter(page, '/unavailable-shell-acceptance-address');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to workspace', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard$/);
});

test('labelled lazy-resource failure keeps route errors safe and reload recovers', async ({ page }) => {
  await enter(page, '/today-status'); await expect(page.getByRole('heading', { name: 'Today, at a glance', exact: true })).toBeVisible();
  await page.route('**/assets/ManagersPage-*.js', route => route.abort('failed'));
  await page.goto('/managers'); await expect(page.getByRole('heading', { name: 'This page is unavailable' })).toBeVisible();
  await expect(page.getByRole('alert')).not.toContainText(/dynamically imported|\.js|127\.0\.0\.1|TypeError/);
  await page.unroute('**/assets/ManagersPage-*.js'); await page.getByRole('button', { name: 'Reload page', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Managers', exact: true })).toBeVisible(); await noOverflow(page);
});
