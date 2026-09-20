import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.DASHBOARD_TEST_ORIGIN || 'http://127.0.0.1:5178';
const sites = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: `Site ${i + 1}`, timezone: 'Asia/Karachi' }));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  for (const scenario of [
    { name: 'three sites', selected: sites.slice(0, 3), width: 1440 },
    { name: 'selected site', selected: sites.slice(1, 2), width: 1440, search: '?locationId=2&date=2026-10-12' },
    { name: 'mobile lazy trends', selected: sites.slice(0, 3), width: 390 },
    { name: 'many sites preview', selected: sites, width: 1440 },
    { name: 'retry trends', selected: sites.slice(0, 3), width: 1440, failOnce: true },
    { name: 'empty scope', selected: [], width: 1440 },
  ]) {
    const context = await browser.newContext({ viewport: { width: scenario.width, height: 1000 } });
    const requests = [], errors = [];
    let trendCalls = 0;
    await context.route(origin + '/api/**', async route => {
      const url = new URL(route.request().url());
      requests.push(url);
      let data = {};
      if (url.pathname === '/api/common/get-current-user') data = { id: 1, companyId: 1, role: 'ADMIN', name: 'Owner', email: 'owner@test.invalid' };
      else if (url.pathname === '/api/subscription') data = { company: { id: 1, subscriptionStatus: 'ACTIVE' }, usage: { locations: 6, staff: 3, managers: 1 }, plan: { name: 'Pro', limits: { locations: 10, staff: 25, managers: 3 }, features: { managerAccess: true } } };
      else if (url.pathname === '/api/manager/operations/overview') data = {
        locations: sites, selected: scenario.selected, days: [], asOf: '2026-10-16T12:00:00Z', date: 'today',
        metrics: { present: 0, scheduled: 0, totalStaff: 0, totalTasks: 0, submitted: 0, reviewCount: 0, verified: 0, accepted: 0 },
        chart: { submitted: 0, inProgress: 0, notStarted: 0, overdue: 0 }, attention: [], tasks: [],
        comparison: scenario.selected.slice(0, 4).map(location => ({ location, present: 0, scheduled: 0, tasks: 0, submitted: 0, reviews: 0 })),
      };
      else if (url.pathname === '/api/manager/operations/trends') {
        trendCalls++;
        if (scenario.failOnce && trendCalls <= 2) return route.fulfill({ status: 503, json: { message: 'Temporary test failure' } });
        data = { rows: scenario.selected.map(l => ({ locationId: l.id,
          current: { dateFrom: '2026-10-10', dateTo: '2026-10-16', submitted: 2, scheduled: 5 },
          previous: { dateFrom: '2026-10-03', dateTo: '2026-10-09', submitted: 1, scheduled: 4 },
        })) };
      } else if (url.pathname === '/api/verification-exceptions/count') data = { total: 7 };
      await route.fulfill({ json: { success: true, data } });
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/dashboard' + (scenario.search || ''));
    await page.locator('.overview-flow').waitFor();
    await page.waitForFunction(() => document.querySelector('body')?.textContent.includes('Reviews'));
    if (scenario.selected.length) {
      const panel = page.locator('.trends-panel');
      if (scenario.width < 1024 || scenario.selected.length > 4) {
        assert.equal(trendCalls, 0, scenario.name + ' defers requests while collapsed');
        await panel.locator('summary').click();
      }
      if (scenario.failOnce) {
        await panel.getByRole('button', { name: 'Try again' }).waitFor({ timeout: 25000 });
        await panel.getByRole('button', { name: 'Try again' }).click();
      }
      await page.waitForFunction(() => document.querySelector('.trend-bar-row span')?.textContent === '2 / 5');
      assert.equal(trendCalls, scenario.failOnce ? 3 : 1, scenario.name + ' uses one batched request');
      assert.equal(await page.locator('.trend-row').count(), scenario.selected.length);
      const trendRequest = requests.find(r => r.pathname.endsWith('/operations/trends'));
      assert.equal(trendRequest.searchParams.get('locationId'), scenario.selected.length === 1 ? '2' : null);
      assert.equal(trendRequest.searchParams.get('date'), scenario.search ? '2026-10-12' : 'today');
      await panel.locator('summary').click();
      await panel.locator('summary').click();
      assert.equal(trendCalls, scenario.failOnce ? 3 : 1, 'reopening reuses cached aggregate');
    } else assert.equal(trendCalls, 0);
    if (scenario.selected.length > 4) await page.getByText('Showing 4 locations').waitFor();
    assert.equal(requests.filter(r => /\/location\/\d+\/stats$/.test(r.pathname)).length, 0);
    assert.equal(requests.filter(r => r.pathname === '/api/verification-exceptions').length, 0);
    assert.equal(requests.filter(r => r.pathname === '/api/verification-exceptions/count').length, 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log('PASS ' + scenario.name + ': bounded requests, displayed counts and review count endpoint');
    await context.close();
  }
} finally { await browser.close(); }
