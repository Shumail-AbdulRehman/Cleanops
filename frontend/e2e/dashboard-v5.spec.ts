import { test, expect, enter, fixture, backend } from './fixtures';
import { choose, copy, noOverflow } from './workspace-helpers';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('owner and manager scoped performance render real totals in English Urdu desktop phone', async ({ browser }) => {
  test.setTimeout(90000);
  for (const who of ['ownerA', 'managerA']) for (const width of [1366, 390]) for (const lang of ['en', 'ur']) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      const page = await context.newPage(); await enter(page, '/dashboard', who, lang);
      await expect(page.getByRole('heading', { name: copy(who === 'ownerA' ? 'Company performance' : 'Location overview', lang), exact: true })).toBeVisible();
      const response = await page.request.get(backend + '/api/manager/operations/performance'); expect(response.status()).toBe(200);
      const data = (await response.json()).data;
      if (who === 'ownerA') {
        const locations = page.getByRole('region', { name: copy('Every location, in focus', lang) });
        await expect(locations.getByRole('row')).toHaveCount(data.sites.length + 1);
        for (const site of data.sites) await expect(locations.getByRole('link', { name: site.location.name, exact: true })).toBeVisible();
      } else {
        expect(data.sites.map((site: { location: { id: number } }) => site.location.id)).toEqual([fixture.site.A]);
        await expect(page.getByRole('heading', { name: copy('Every location, in focus', lang) })).toHaveCount(0);
      }
      await noOverflow(page);
    } finally { await context.close(); }
  }
});

test('performance period and location persist after reload, figures change, search and authorization work', async ({ page }) => {
  await enter(page, '/dashboard');
  const locations = page.getByRole('region', { name: 'Every location, in focus', exact: true });
  await expect(locations.getByRole('row').filter({ hasText: 'E2E site B' }).getByRole('cell').nth(2)).toContainText('0 / 0');
  await page.getByRole('button', { name: 'Last 30 days', exact: true }).click(); await expect(page).toHaveURL(/period=30/);
  await expect(locations.getByRole('row').filter({ hasText: 'E2E site B' }).getByRole('cell').nth(2)).toContainText('1 / 1');
  await page.getByText('View daily figures', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Daily figures', exact: true }).getByRole('row')).toHaveCount(31);
  await page.getByRole('searchbox', { name: 'Find a location', exact: true }).fill('not-a-site');
  await expect(page.getByRole('heading', { name: 'No matching locations.', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).first().click();
  await choose(page, 'Location', 'E2E site A');
  await expect(page).toHaveURL(new RegExp('locationId=' + fixture.site.A));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Last 30 days', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Location: E2E site A', exact: true })).toBeVisible();
  const region = page.getByRole('region', { name: 'Every location, in focus', exact: true });
  await expect(region.getByRole('row')).toHaveCount(2);
  await enter(page, '/dashboard', 'managerA');
  expect((await page.request.get(backend + '/api/manager/operations/performance?locationId=' + fixture.site.B)).status()).toBe(403);
  expect((await page.request.get(backend + '/api/manager/operations/performance?locationId=' + fixture.site.foreign)).status()).toBe(403);
  await page.route('**/api/manager/operations/performance?*', route => route.abort('failed')); await page.reload();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.unroute('**/api/manager/operations/performance?*'); await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Work submitted', exact: true })).toBeVisible();
});

test('dashboard overdue and attendance follow-up retain site and day filters', async ({ page }) => {
  await enter(page, `/dashboard?locationId=${fixture.site.A}&date=2026-10-20`);
  await page.getByRole('link', { name: /Overdue work/ }).click(); await expect(page).toHaveURL(/status=overdue/);
  await expect(page).toHaveURL(/date=2026-10-20/);
  await page.goto(`/dashboard?locationId=${fixture.site.A}&date=2026-10-20`);
  await page.getByRole('link', { name: /Attendance follow-up/ }).click();
  await expect(page).toHaveURL(/from=2026-10-20/);
  await expect(page.getByRole('button', { name: 'Location: E2E site A', exact: true })).toBeVisible();
});
