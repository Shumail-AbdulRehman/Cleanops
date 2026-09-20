import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.LOCATION_TEST_ORIGIN || 'http://127.0.0.1:5178';
const screenshotDir = process.env.LOCATION_SCREENSHOTS || '/tmp/hygene-location-tabs';
await mkdir(screenshotDir, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  for (const scenario of [
    { name: 'owner-desktop', width: 1440, role: 'ADMIN' },
    { name: 'manager-mobile', width: 390, role: 'MANAGER' },
    { name: 'owner-urdu', width: 1440, role: 'ADMIN', urdu: true },
  ]) {
    const context = await browser.newContext({ viewport: { width: scenario.width, height: 1000 } });
    const errors = [], created = [];
    let rejectNext = true;
    const site = { id: 7, name: 'I-14/3', address: 'Hostel', latitude: '33.65', longitude: '73.02', timezone: 'Asia/Karachi', radiusMeters: 500, isActive: true, staff: [
      { id: 9, name: 'Test Worker', email: 'worker@example.test', isActive: true, shiftStart: '1970-01-01T04:00:00Z', shiftEnd: '1970-01-01T12:00:00Z' },
    ], taskTemplates: [], taskInstances: [] };
    const overview = { locations: [site], selected: [site], days: [], date: 'today', asOf: '2026-10-16T12:00:00Z',
      metrics: { present: 1, scheduled: 1, totalStaff: 1, totalTasks: 3, submitted: 0, reviewCount: 2, verified: 0, accepted: 0 },
      chart: { submitted: 0, inProgress: 0, notStarted: 0, overdue: 3 }, attention: [], tasks: [], comparison: [],
    };
    await context.route(origin + '/api/**', async route => {
      const url = new URL(route.request().url());
      let data = {};
      if (url.pathname === '/api/common/get-current-user') data = { id: 1, companyId: 1, role: scenario.role, name: 'Demo Owner', email: 'owner@example.test' };
      else if (url.pathname === '/api/subscription') data = { company: { id: 1, subscriptionStatus: 'ACTIVE' }, usage: { locations: 1, staff: 1, managers: 1 }, plan: { name: 'Pro', limits: { locations: 5, staff: 25, managers: 3 }, features: { managerAccess: true } } };
      else if (url.pathname === '/api/location/7/stats') data = { locationInfo: site, taskStats: [] };
      else if (url.pathname === '/api/location/' || url.pathname === '/api/location') data = [site];
      else if (url.pathname === '/api/staff/') data = site.staff;
      else if (url.pathname === '/api/staff/create-staff') {
        const body = route.request().postDataJSON();
        if (rejectNext) { rejectNext = false; return route.fulfill({ status: 409, json: { message: 'This email is already used.' } }); }
        created.push(body);
        const staff = { ...body, id: 10 + created.length, isActive: true };
        site.staff.push(staff);
        data = staff;
      } else if (url.pathname === '/api/manager/operations/overview') data = overview;
      else if (url.pathname === '/api/manager/operations/staff') data = { rows: [], locations: [site], total: 0 };
      else if (url.pathname === '/api/verification-exceptions/count') data = { total: 2 };
      else if (url.pathname === '/api/location/7/schedule') data = { location: site, weekStart: '2026-10-12', days: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${12 + i}`, items: [] })) };
      else if (url.pathname.includes('areas') || url.pathname === '/api/area/migration/templates') data = [];
      await route.fulfill({ json: { success: true, data } });
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/locations/7');
    await page.locator('.location-detail-page .ops-metrics .ops-metric').first().waitFor();
    if (scenario.urdu) await page.getByRole('button', { name: 'اردو', exact: true }).click();
    const tabs = page.locator('.detail-tab-list > button');
    const initialY = (await page.locator('.location-detail-page > .ops-tabs').boundingBox()).y;
    for (let i = 0; i < 6; i++) {
      await tabs.nth(i).click();
      assert.deepEqual(errors, [], `tab ${i} renders successfully`);
      await page.locator('.location-detail-page > .ops-tabs').waitFor();
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(await page.locator('.location-detail-page .ops-metrics .ops-metric').count(), 4);
      assert.ok(Math.abs((await page.locator('.location-detail-page > .ops-tabs').boundingBox()).y - initialY) < 2, 'tab navigation stays at the same height');
      assert.equal(await page.locator('.location-history-filters').count(), i === 5 ? 1 : 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (i === 2) {
        await page.locator('.location-staff-panel').waitFor();
        await page.screenshot({ path: `${screenshotDir}/${scenario.name}-staff.png`, fullPage: true });
      }
    }
    await tabs.nth(2).click();
    await page.locator('.location-staff-panel .ops-panel-heading button').click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(await dialog.locator('#staff-create-locationId').inputValue(), '7');
    assert.equal(await dialog.locator('#staff-create-locationId').isDisabled(), true);
    await dialog.locator('#staff-create-name').fill('New teammate');
    await dialog.locator('#staff-create-email').fill('new@example.test');
    await dialog.locator('#staff-create-phone').fill('+923001234567');
    await dialog.locator('#staff-create-password').fill('TestOnly123!');
    await dialog.locator('#staff-create-shiftStart').fill('09:00');
    await dialog.locator('#staff-create-shiftEnd').fill('17:00');
    await dialog.locator('button[type=submit]').click();
    await dialog.getByRole('alert').waitFor();
    assert.match(await dialog.getByRole('alert').innerText(), /already used/);
    await page.screenshot({ path: `${screenshotDir}/${scenario.name}-add-staff.png`, fullPage: true });
    await dialog.locator('button[type=submit]').click();
    await dialog.waitFor({ state: 'hidden' });
    await page.locator('.location-staff-panel').getByText('New teammate', { exact: true }).filter({ visible: true }).waitFor();
    assert.equal(created.length, 1);
    assert.equal(created[0].locationId, 7);
    assert.equal(created[0].shiftStart, '1970-01-01T04:00:00.000Z');
    assert.equal(created[0].shiftEnd, '1970-01-01T12:00:00.000Z');
    await page.locator('.location-staff-panel .ops-panel-heading button').click();
    await dialog.waitFor();
    assert.equal(await dialog.locator('#staff-create-name').inputValue(), '');
    assert.equal(await dialog.getByRole('alert').count(), 0);
    await dialog.locator('button[type=button]').filter({ hasText: scenario.urdu ? 'منسوخ' : 'Cancel' }).click();
    assert.equal(created.length, 1, 'cancel does not create an account');
    if (scenario.name === 'owner-desktop') {
      await page.goto(origin + '/staff');
      await page.getByRole('button', { name: 'Add staff', exact: true }).click();
      await dialog.waitFor();
      assert.equal(await dialog.locator('#staff-create-locationId').isEnabled(), true);
      assert.equal(await dialog.locator('#staff-create-locationId').inputValue(), '');
      await dialog.locator('#staff-create-locationId').selectOption('7');
      await dialog.locator('#staff-create-name').fill('Team page teammate');
      await dialog.locator('#staff-create-email').fill('team@example.test');
      await dialog.locator('#staff-create-phone').fill('+923001234568');
      await dialog.locator('#staff-create-password').fill('TestOnly123!');
      await dialog.locator('#staff-create-shiftStart').fill('09:00');
      await dialog.locator('#staff-create-shiftEnd').fill('17:00');
      await dialog.locator('button[type=submit]').click();
      await dialog.waitFor({ state: 'hidden' });
      await page.getByText('Team page teammate', { exact: true }).filter({ visible: true }).waitFor();
      assert.equal(created.length, 2);
      assert.equal(created[1].locationId, 7);
      assert.equal(created[1].shiftStart, '1970-01-01T04:00:00.000Z');
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${scenario.name}: six stable tabs, shared summary, local history filters, staff save/error/cancel, timezone and list refresh`);
    await context.close();
  }
} finally { await browser.close(); }
