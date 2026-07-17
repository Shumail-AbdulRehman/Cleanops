import { addScheduleButton, ui, choose, calendar } from './workspace-helpers';
import type { Page } from '@playwright/test';
import { test, expect, enter, fixture, sql, backend } from './fixtures';

// All reads reach the managed backend and its disposable migrated PostgreSQL
// database. Never substitute responses or persist credential-bearing artifacts.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});

type Site = { id: number; name: string; timezone: string; isActive: boolean };
type Person = { id: number; name: string; companyId?: number; locationId?: number };
type Performance = {
  locations: Site[]; selected: Site[]; sites: Array<{ location: Site }>;
  summary: { totalLocations: number; totalStaff: number; scheduledShifts: number; present: number; tasks: number; submitted: number };
  series: Array<{ date: string; scheduledShifts: number; tasks: number }>;
  dateFrom: string; dateTo: string; period: number;
};
type OperationPage<T> = { rows: T[]; total: number; page: number; totalPages: number; pageSize: number; locations: Site[] };

function browserRead<T>(page: Page, path: string, query: Record<string, string> = {}) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === '/api' + path &&
      Object.entries(query).every(([key, value]) => url.searchParams.get(key) === value);
  }).then(async response => {
    expect(response.status(), `GET ${path}`).toBe(200);
    const body = await response.json();
    expect(body.success, `GET ${path} envelope`).toBe(true);
    expect(body).toHaveProperty('data');
    return body.data as T;
  });
}

async function visit<T>(page: Page, route: string, endpoint: string, query: Record<string, string> = {}, who = 'ownerA') {
  const read = browserRead<T>(page, endpoint, query);
  await enter(page, route, who);
  return read;
}

async function healthy(page: Page) {
  await expect(page.locator('.skeleton:visible')).toHaveCount(0);
  await expect(page.getByText('Records could not load. Check your connection and try again.', { exact: true })).toHaveCount(0);
  await expect(page.getByText('This page is unavailable', { exact: true })).toHaveCount(0);
  for (const text of ['Loading performance…', 'Loading billing records…', 'Loading setup status…', 'Loading company settings…', 'Loading owner verification…', 'Loading area template…', 'Loading support contact…'])
    await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  expect(pageErrors.get(page)).toEqual([]);
}

async function attendanceDay(id: number) {
  const [row] = await sql('SELECT to_char(a.date AT TIME ZONE \'UTC\' AT TIME ZONE l.timezone, \'YYYY-MM-DD\') AS day FROM "Attendance" a JOIN "Location" l ON l.id=a."locationId" WHERE a.id=$1', [id]);
  return row.day as string;
}

test('company performance renders database totals and applies real period and location filters', async ({ page }) => {
  const day = await attendanceDay(fixture.attendance.openShift);
  const expectedSites: Array<Pick<Site, 'id' | 'name'>> = await sql('SELECT id,name FROM "Location" WHERE "companyId"=$1 AND "isActive" ORDER BY name', [fixture.company.A]);
  const report = await visit<Performance>(page, '/dashboard?date=' + day, '/manager/operations/performance');
  expect(report.sites.map(site => site.location.id)).toEqual(expectedSites.map(site => site.id));
  expect(report.summary.totalLocations).toBe(expectedSites.length);
  const [totals] = await sql(`SELECT
    (SELECT count(*)::int FROM "Staff" s JOIN "Location" l ON l.id=s."locationId" WHERE s."companyId"=$1 AND s."isActive" AND l."isActive") AS staff,
    (SELECT count(*)::int FROM "Attendance" a JOIN "Location" l ON l.id=a."locationId" WHERE l."companyId"=$1 AND l."isActive" AND (a.date AT TIME ZONE 'UTC' AT TIME ZONE l.timezone)::date BETWEEN $2::date AND $3::date) AS shifts,
    (SELECT count(*)::int FROM "Attendance" a JOIN "Location" l ON l.id=a."locationId" WHERE l."companyId"=$1 AND l."isActive" AND a."checkInTime" IS NOT NULL AND (a.date AT TIME ZONE 'UTC' AT TIME ZONE l.timezone)::date BETWEEN $2::date AND $3::date) AS present`, [fixture.company.A, report.dateFrom, report.dateTo]);
  expect(report.summary).toMatchObject({ totalStaff: totals.staff, scheduledShifts: totals.shifts, present: totals.present });
  await expect(page.getByRole('region', { name: ui('Every location, in focus') }).getByRole('row').filter({ has: page.getByRole('cell') })).toHaveCount(expectedSites.length);
  for (const site of expectedSites) await expect(page.getByRole('region', { name: ui('Every location, in focus') })).toContainText(site.name);
  const thirty = browserRead<Performance>(page, '/manager/operations/performance', { period: '30' });
  await page.getByRole('button', { name: 'Last 30 days', exact: true }).click();
  expect((await thirty).series).toHaveLength(30);
  await page.getByText('View daily figures', {exact:true}).click();
  await expect(page.getByRole('region', { name: ui('Daily figures') }).getByRole('row').filter({ has: page.getByRole('cell') })).toHaveCount(30);
  const scoped = browserRead<Performance>(page, '/manager/operations/performance', { locationId: String(fixture.site.A), period: '30' });
  await choose(page, 'Location', 'E2E site A');
  expect((await scoped).sites.map(site => site.location.id)).toEqual([fixture.site.A]);
  await expect(page.getByRole('region', { name: ui('Every location, in focus') }).getByRole('row').filter({ has: page.getByRole('cell') })).toHaveCount(1);
  await healthy(page);
});

test('Today task and staff registers complete real scoped date, search and pagination reads', async ({ page }) => {
  const day = await attendanceDay(fixture.attendance.openShift);
  const route = `/today-status?locationId=${fixture.site.A}&date=${day}`;
  const overview = browserRead<{ metrics: { totalStaff: number; totalTasks: number }; selected: Site[] }>(page, '/manager/operations/overview');
  const tasks = await visit<OperationPage<{ id: number; locationId: number; title: string }>>(page, route + '&tab=tasks&pageSize=1', '/manager/operations/tasks', { pageSize: '1' });
  expect((await overview).selected.map(site => site.id)).toEqual([fixture.site.A]);
  expect(tasks).toMatchObject({ page: 1, pageSize: 1 });
  expect(tasks.rows).toHaveLength(1);
  expect(tasks.rows.every(task => task.locationId === fixture.site.A)).toBe(true);
  await expect(page.getByRole('region', { name: ui('Daily records') })).toContainText(tasks.rows[0].title);
  const filteredRead = browserRead<OperationPage<{ id: number }>>(page, '/manager/operations/tasks', { q: 'E2E missing-photo review' });
  await page.getByLabel('Find a task', { exact: true }).fill('E2E missing-photo review');
  const filtered = await filteredRead;
  expect(filtered.rows.map(task => task.id)).toEqual([fixture.review.taskId]);
  await expect(page.getByRole('region', { name: ui('Daily records') })).toContainText('E2E review room');
  const staff = await visit<OperationPage<Person>>(page, route + '&tab=staff&pageSize=1&page=2', '/manager/operations/staff', { page: '2' });
  const [count] = await sql('SELECT count(*)::int AS n FROM "Staff" WHERE "companyId"=$1 AND "locationId"=$2 AND "isActive"', [fixture.company.A, fixture.site.A]);
  expect(staff).toMatchObject({ total: count.n, page: 2, pageSize: 1 });
  await expect(page.getByRole('region', { name: ui('Daily records') })).toContainText(staff.rows[0].name);
  await healthy(page);
});

test('Photo Reviews and task-photo bookmarks load persisted queue and detail contracts', async ({ page }) => {
  const [record] = await sql('SELECT e.state,e."areaId",a.name AS "areaName" FROM "VerificationException" e JOIN "Area" a ON a.id=e."areaId" WHERE e.id=$1', [fixture.review.id]);
  const queue = record.state === 'RESOLVED' ? 'resolved' : 'needs-me';
  const detail = browserRead<{ id: number; items: unknown[]; location: Site }>(page, `/verification-exceptions/${fixture.review.id}`);
  const reviews = await visit<{ cases: Array<{ id: number }>; total: number; locations: Site[] }>(page, `/exceptions/${fixture.review.id}?queue=${queue}&period=all`, '/verification-exceptions', {queue,period:'all'});
  expect(reviews.cases.map(review => review.id)).toContain(fixture.review.id);
  expect((await detail).location.id).toBe(fixture.site.A);
  await expect(page.getByRole('region', { name: ui('Required photo views') })).toBeVisible();
  await expect(page.getByRole('link').filter({ hasText: record.areaName }).filter({ hasText: record.areaName })).toBeVisible();
  await healthy(page);
  const task = browserRead<{ id: number; verificationVersion: number }>(page, `/task-instance/${fixture.review.taskId}`);
  await page.goto('/verification/' + fixture.review.taskId);
  expect(await task).toMatchObject({ id: fixture.review.taskId, verificationVersion: 2 });
  await expect(page).toHaveURL(new RegExp(`/exceptions/${fixture.review.id}\\?`));
  await expect(page.getByRole('region', { name: ui('Required photo views') })).toBeVisible();
  await healthy(page);
});

test('Locations and every implemented location tab load persisted API records', async ({ page }) => {
  test.setTimeout(60000);
  const sites = await visit<Site[]>(page, '/locations', '/location/', { includeInactive: 'true' });
  expect(sites.map(site => site.id)).toContain(fixture.site.A);
  const [location] = await sql('SELECT id,name FROM "Location" WHERE id=$1', [fixture.site.A]);
  await expect(page.getByRole('list', { name: ui('Location register') })).toContainText(location.name);
  await healthy(page);
  for (const tab of ['overview', 'staff', 'templates', 'areas', 'instances', 'schedule']) {
    await test.step(tab, async () => {
      const details = browserRead<{ locationInfo: { id: number; name: string; staff: Person[]; taskInstances: unknown[] }; taskStats: unknown[] }>(page, `/location/${fixture.site.A}/stats`);
      const extra = tab === 'areas' || tab === 'overview'
        ? browserRead<Array<{ id: number; name: string }>>(page, `/location/${fixture.site.A}/areas`)
        : tab === 'schedule'
          ? browserRead<{ location: Site; days: unknown[] }>(page, `/location/${fixture.site.A}/schedule`)
          : undefined;
      await page.goto(`/locations/${fixture.site.A}?tab=${tab}`);
      expect((await details).locationInfo).toMatchObject(location);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(location.name);
      if (tab === 'areas' || tab === 'overview') expect(await extra).toEqual(expect.any(Array));
      if (tab === 'areas') await expect(page.getByRole('main')).toContainText('E2E review room');
      if (tab === 'overview') await expect(page.getByRole('region', { name: ui('Daily summary') })).toBeVisible();
      if (tab === 'schedule') {
        expect(await extra).toMatchObject({ location: { id: fixture.site.A }, days: expect.any(Array) });
        await expect(page.getByRole('heading', { name: ui('Week at a glance') })).toBeVisible();
      }
      if (tab === 'staff') await expect(page.getByRole('tabpanel', { name: ui('Staff and shifts') })).toContainText('E2E staff openShift');
      if (tab === 'templates') await expect(addScheduleButton(page)).toBeVisible();
      await healthy(page);
    });
  }
});

test('Team and worker history display real persisted people and attendance', async ({ page }) => {
  const people = await visit<Person[]>(page, '/staff', '/staff/');
  const expected: Person[] = await sql('SELECT id,name FROM "Staff" WHERE "companyId"=$1 AND "isActive" ORDER BY id', [fixture.company.A]);
  expect(people.map(person => person.id).sort((a, b) => a - b)).toEqual(expected.map(person => person.id));
  await expect(page.getByRole('table')).toContainText('E2E staff openShift');
  await healthy(page);
  const day = await attendanceDay(fixture.attendance.legacy);
  const detail = await visit<{ id: number; name: string; attendanceStats: unknown; attendances: unknown[] }>(page, `/staff/${fixture.staff.legacy.id}?tab=attendance&dateFrom=${day}&dateTo=${day}`, `/staff/details/${fixture.staff.legacy.id}`);
  expect(detail).toMatchObject({ id: fixture.staff.legacy.id, name: 'E2E staff legacy', attendanceStats: expect.any(Object) });
  await expect(page.getByRole('heading', { name: 'E2E staff legacy', exact: true })).toBeVisible();
  await expect(page.getByText('Attendance records', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Attendance context(?::|$)/ }).filter({ visible: true })).toHaveCount(1);
  await healthy(page);
});

test('Attendance renders saved shifts, real context and genuine empty date filters', async ({ page }) => {
  const day = await attendanceDay(fixture.attendance.openShift);
  const records = await visit<Array<{ id: number; staff: Person; location: Site }>>(page, `/attendance?locationId=${fixture.site.A}&from=${day}&to=${day}`, '/attendance/', { from: day, to: day });
  expect(records.map(record => record.id)).toContain(fixture.attendance.openShift);
  expect(records.every(record => record.location.id === fixture.site.A)).toBe(true);
  await expect(page.getByRole('region', { name: ui('Attendance records') })).toContainText('E2E staff openShift');
  await healthy(page);
  const context = browserRead<{ attendanceId: number; items: unknown[] }>(page, `/attendance/${fixture.attendance.openShift}/annotations`);
  await page.getByRole('row').filter({ hasText: 'E2E staff openShift' }).getByRole('button', { name: /^Attendance context(?::|$)/ }).click();
  expect(await context).toMatchObject({ attendanceId: fixture.attendance.openShift, items: expect.any(Array) });
  await expect(page.getByRole('dialog')).toContainText('Original captured facts');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).first().click();
  await page.getByText('More filters', { exact: true }).click();
  await calendar(page, 'From date', '2090-01-01');
  await calendar(page, 'To date', '2090-01-02');
  const empty = browserRead<unknown[]>(page, '/attendance/', { from: '2090-01-01' });
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  expect(await empty).toEqual([]);
  await expect(page.getByText('No attendance records found for the selected filters.', { exact: true })).toBeVisible();
  await healthy(page);
});

test('Company Setup derives persisted site readiness and owner account facts', async ({ page }) => {
  const billing = browserRead<{ company: { id: number }; ownerVerified: boolean }>(page, '/subscription/manage/lifecycle');
  const data = await visit<{ sites: Array<{ id: number; name: string; counts: { activeAreas: number } }>; totalLocations: number; access: { manageWork: boolean } }>(page, '/setup', '/location/readiness');
  expect((await billing).company.id).toBe(fixture.company.A);
  const expected: Array<Pick<Site, 'id' | 'name'> & { areas: number }> = await sql('SELECT l.id,l.name,(SELECT count(*)::int FROM "Area" a WHERE a."locationId"=l.id AND a.status=\'ACTIVE\') AS areas FROM "Location" l WHERE l."companyId"=$1 AND l."isActive" ORDER BY l.id', [fixture.company.A]);
  expect(data.sites.map(site => site.id)).toEqual(expected.map(site => site.id));
  expect(data.totalLocations).toBe(expected.length);
  for (const site of data.sites) expect(site.counts.activeAreas).toBe(expected.find(row => row.id === site.id)?.areas);
  await expect(page.getByRole('button', { name: /^Setup for location:/ })).toContainText(data.sites[0].name);
  await expect(page.getByText('Owner email', { exact: true })).toBeVisible();
  await healthy(page);
});

test('Managers renders actual company manager assignments', async ({ page }) => {
  const managers = await visit<Array<Person & { locations: Site[] }>>(page, '/managers', '/manager/');
  const expected: Person[] = await sql('SELECT id,name FROM "Manager" WHERE "companyId"=$1 AND role=\'MANAGER\' ORDER BY id', [fixture.company.A]);
  expect(managers.map(manager => manager.id).sort((a, b) => a - b)).toEqual(expected.map(manager => manager.id));
  await expect(page.getByRole('table')).toContainText('E2E manager A');
  expect(managers.find(manager => manager.id === fixture.users.managerA.id)?.locations.map(site => site.id)).toEqual([fixture.site.A]);
  await healthy(page);
});

test('Settings organization and My account load saved company and owner identity', async ({ page }) => {
  const settings = await visit<{ id: number; name: string; accountVersion: number }>(page, '/settings', '/company/settings');
  const [saved] = await sql('SELECT id,name,"accountVersion" FROM "Company" WHERE id=$1', [fixture.company.A]);
  expect(settings).toMatchObject(saved);
  await expect(page.getByLabel('Company name', { exact: true })).toHaveValue(saved.name);
  const identity = browserRead<{ emailVerified: boolean; deliveryConfigured: boolean; bootstrapRequired: boolean }>(page, '/owner-identity/status');
  await page.getByRole('button', { name: 'My account', exact: true }).click();
  const status = await identity;
  const [owner] = await sql('SELECT "emailVerifiedAt" IS NOT NULL AS verified,email FROM "Manager" WHERE id=$1', [fixture.users.ownerA.id]);
  expect(status.emailVerified).toBe(owner.verified);
  await expect(page.getByRole('region', { name: 'My account', exact: true })).toContainText(owner.email);
  await expect(page.getByRole('region', { name: ui('My account') })).toContainText(status.emailVerified ? 'Owner email is verified.' : 'Owner email is not verified.');
  await healthy(page);
});

test('Plan and Billing displays persisted provider linkage and capacity without live purchases', async ({ page }) => {
  const lifecycle = await visit<{ company: { id: number; name: string }; usage: { locations: number; staff: number; managers: number }; providerState: string; subscription: { status: string }; billingConfigured: boolean }>(page, '/subscription', '/subscription/manage/lifecycle');
  const [saved] = await sql('SELECT c.id,c.name,s.status FROM "Company" c JOIN "PaddleSubscription" s ON s.id=c."billingSubscriptionId" WHERE c.id=$1', [fixture.company.A]);
  expect(lifecycle).toMatchObject({ company: { id: saved.id, name: saved.name }, providerState: 'MIRRORED', subscription: { status: saved.status }, billingConfigured: false });
  const [usage] = await sql(`SELECT
    (SELECT count(*)::int FROM "Location" WHERE "companyId"=$1 AND "isActive") AS locations,
    (SELECT count(*)::int FROM "Staff" WHERE "companyId"=$1 AND "isActive") AS staff,
    (SELECT count(*)::int FROM "Manager" WHERE "companyId"=$1 AND "isActive") AS managers`, [fixture.company.A]);
  expect(lifecycle.usage).toEqual(usage);
  await expect(page.getByRole('heading', { name: 'Plan & billing', exact: true })).toBeVisible();
  await expect(page.getByRole('region').filter({ has: page.getByRole('heading', { name: /^Starter$/i, exact: true }) })).toContainText('Active');
  await expect(page.getByText('Workspace usage',{exact:true})).toBeVisible();await expect(page.getByText(new RegExp(`^${usage.staff} / `))).toBeVisible();
  await healthy(page);
});

test('inactive location directory opt-in preserves active selectors and assigned-site/company isolation', async ({ page }) => {
  const [before] = await sql('SELECT "isActive" FROM "Location" WHERE id=$1', [fixture.site.B]);
  try {
    // The managed harness guards this disposable database. Restore its fixture
    // flag even on failure; retained records and their relationships stay intact.
    await sql('UPDATE "Location" SET "isActive"=false WHERE id=$1', [fixture.site.B]);
    const directory = await visit<Site[]>(page, '/locations', '/location/', { includeInactive: 'true' });
    expect(directory.find(site => site.id === fixture.site.B)).toMatchObject({ isActive: false });
    const active = await page.request.get(backend + '/api/location/');
    expect(active.status()).toBe(200);
    expect((await active.json()).data.map((site: Site) => site.id)).not.toContain(fixture.site.B);
    await choose(page, 'Location status', 'Inactive locations');
    await expect(page.getByRole('list', { name: 'Location register' }).getByRole('link')).toHaveCount(1);
    await expect(page.getByRole('list', { name: 'Location register' })).toContainText('E2E site B');
    await choose(page, 'Location status', 'All locations');
    await expect(page.getByRole('list', { name: 'Location register' })).toContainText('E2E site A');
    await expect(page.getByRole('list', { name: 'Location register' })).toContainText('E2E site B');
    await page.goto('/attendance');
    await page.getByRole('button', { name: /^Location:/ }).click();
    await expect(page.getByRole('menuitemradio', { name: 'E2E site B', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    const manager = await visit<Site[]>(page, '/locations', '/location/', { includeInactive: 'true' }, 'managerA');
    expect(manager.map(site => site.id)).toEqual([fixture.site.A]);
    await choose(page, 'Location status', 'All locations');
    await expect(page.getByRole('list', { name: 'Location register' })).not.toContainText('E2E site B');
    await expect(page.getByRole('list', { name: 'Location register' })).not.toContainText('E2E site foreign');
    for (const id of [fixture.site.B, fixture.site.foreign]) {
      const denied = await page.request.get(backend + `/api/location/${id}/stats`);
      expect([403, 404]).toContain(denied.status());
    }
    await healthy(page);
  } finally {
    await sql('UPDATE "Location" SET "isActive"=$2 WHERE id=$1', [fixture.site.B, before.isActive]);
  }
});

test('actual backend denial terminates the performance loading label and authorized navigation recovers', async ({ page }) => {
  const failed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/manager/operations/performance' && response.status() === 403);
  await enter(page, '/dashboard?locationId=' + fixture.site.B, 'managerA');
  const denied = await failed;
  expect((await denied.json()).success).toBe(false);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('Loading performance…', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Reporting period', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: ui('Work submitted') })).toHaveCount(0);
  for (const path of [
    `/manager/operations/performance?locationId=${fixture.site.foreign}`,
    `/manager/operations/tasks?locationId=${fixture.site.B}`,
    `/attendance?locationId=${fixture.site.foreign}`,
    '/company/settings',
    '/subscription/manage/lifecycle',
  ]) expect((await page.request.get(backend + '/api' + path)).status(), path).toBe(403);
  expect((await page.request.get(backend + '/api/manager/operations/performance?date=2026-02-30')).status()).toBe(400);
  const read = browserRead<Performance>(page, '/manager/operations/performance', { locationId: String(fixture.site.A) });
  await page.goto('/dashboard?locationId=' + fixture.site.A);
  expect((await read).sites.map(site => site.location.id)).toEqual([fixture.site.A]);
  await expect(page.getByRole('heading', { name: ui('Work submitted') })).toBeVisible();
  await healthy(page);
  const foreign = await visit<Performance>(page, '/dashboard', '/manager/operations/performance', {}, 'ownerB');
  expect(foreign.sites.map(site => site.location.id)).toEqual([fixture.site.foreign]);
  await expect(page.getByRole('region', { name: ui('Every location, in focus') })).toContainText('E2E site foreign');
  await expect(page.getByRole('region', { name: ui('Every location, in focus') })).not.toContainText('E2E site A');
  await healthy(page);
});
