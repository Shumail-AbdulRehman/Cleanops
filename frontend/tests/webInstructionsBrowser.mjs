import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.WEB_INSTRUCTIONS_ORIGIN || 'http://127.0.0.1:5178';
const instruction = 'Show the whole sink basin, drain and tap.';
const requirement = { id: 'sink-view', viewKey: 'basin_tap', state: 'REVIEW_REQUIRED', instructionsSnapshot: instruction, mandatory: true };
const issue = { id: 10, reasonCode: 'MISSING_SURFACE', state: 'MANAGER_REVIEW', occurrences: 1, requirementId: requirement.id,
  requirement, recommendedAction: 'Show the required parts clearly.', allowedActions: [], firstSeenAt: '2026-10-16T10:00:00Z', lastSeenAt: '2026-10-16T10:00:00Z' };
const task = { id: 7, title: 'Clean the washroom', verificationVersion: 2, verificationState: 'NEEDS_REVIEW', shiftEnd: '2026-10-16T17:00:00Z',
  location: { id: 1, name: 'Test site', timezone: 'Asia/Karachi' }, staff: { id: 2, name: 'Test worker' } };
const detail = { id: 1, kind: 'TASK', state: 'MANAGER_REVIEW', priority: 2, rowVersion: 1, locationId: 1, areaId: 1, taskInstanceId: 7,
  firstRaisedAt: '2026-10-16T10:00:00Z', updatedAt: '2026-10-16T10:00:00Z', location: task.location, area: { id: 1, name: 'East washroom' }, task,
  issues: [issue], allowedActions: [], items: [{ id: 'sink', nameSnapshot: 'Sink 01', mandatory: true, requirements: [requirement] }],
  attempts: [], decisions: [], events: [] };
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  for (const width of [1440, 390]) for (const role of ['ADMIN', 'MANAGER']) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addInitScript(() => {
      window.__speechCalls = 0;
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        cancel() { window.__speechCalls++; }, speak() { window.__speechCalls++; }, getVoices() { return []; },
      } });
    });
    await context.route(origin + '/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      let data = {};
      if (path === '/api/common/get-current-user') data = { id: 1, companyId: 1, role, name: 'Test manager', email: 'manager@example.test' };
      else if (path === '/api/subscription') data = { company: { id: 1, subscriptionStatus: 'ACTIVE' }, usage: { locations: 1, staff: 1, managers: 1 }, plan: { name: 'Pro', limits: { locations: 5, staff: 25, managers: 3 }, features: { managerAccess: true } } };
      else if (path === '/api/verification-exceptions/1') data = detail;
      else if (path === '/api/verification-exceptions/1/next') data = { nextId: null };
      else if (path === '/api/verification-exceptions/count') data = { total: 1 };
      else if (path === '/api/task-instance/7') data = task;
      else if (path === '/api/task-instance/7/verification') data = {
        task, areaId: 1, areaName: 'East washroom', caseSummary: null,
        items: [{ id: 'sink', name: 'Sink 01', mandatory: true, requirements: [{ ...requirement, instructions: instruction }] }],
      };
      await route.fulfill({ json: { success: true, data } });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    for (const path of ['/exceptions/1', '/verification/7']) {
      await page.goto(origin + path);
      const content = page.locator(path.includes('exceptions') ? '.ops-guidance' : '.ops-instructions');
      await content.waitFor();
      assert.ok((await content.innerText()).length > 20, 'written instructions remain available');
      if (path.includes('verification')) await content.getByText(instruction, { exact: true }).waitFor();
      for (const language of ['en', 'ur']) {
        await page.getByRole('button', { name: language === 'ur' ? 'اردو' : 'English', exact: true }).click();
        assert.equal(await page.getByRole('button', { name: /^(Listen|Stop listening|سنیں|سننا بند کریں)$/ }).count(), 0);
        assert.equal(await page.evaluate(() => window.__speechCalls), 0, 'web no longer invokes speech APIs');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${role} ${width}px: review guidance and task instructions retained, Listen removed, English/Urdu switch without speech`);
    await context.close();
  }
} finally { await browser.close(); }
