import { test, expect, enter, fixture, sql, openShiftAttendancePath } from './fixtures';
import { choose, cleaningSchedules, noOverflow, scheduleButton, scheduleDetails, taskPanel } from './workspace-helpers';
import { createRequire } from 'node:module';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

type OverviewResponse = {
  hourly: Array<{ hour: number; due: number; submitted: number | null }>;
  metrics: Record<'present' | 'scheduled' | 'totalTasks' | 'submitted', number>;
  chart: Record<'submitted' | 'inProgress' | 'notStarted' | 'overdue', number>;
  comparison: Array<{ location: { name: string }; tasks: number; submitted: number; present: number; scheduled: number }>;
};

async function capacity() {
  await sql('UPDATE "Company" SET plan=\'ADVANCED\' WHERE id=$1', [fixture.company.A]);
  await sql('UPDATE "PaddleSubscription" SET "priceId"=$2 WHERE "companyId"=$1', [fixture.company.A, 'pri_00000000000000000000000003']);
}

test('W42 new company lands on saved setup path without empty reports or report filters', async ({ page }) => {
  await enter(page, '/dashboard', 'ownerReturn0');
  await expect(page.getByRole('heading', { name: /^Welcome,/ })).toBeVisible();
  const steps = page.getByRole('list', { name: 'Your setup checklist', exact: true });
  await expect(steps.getByRole('listitem')).toHaveCount(4);
  await expect(page.getByRole('group', { name: 'Reporting period' })).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: 'Find a location' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Location|Date):/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Every location, in focus', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Open full checklist', exact: true }).click();
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole('heading', { name: 'No locations yet', exact: true })).toBeVisible();
});

test('W42 Today hourly figures and by-location counts agree with real overview totals', async ({ page }) => {
  // Make a positive submission observable without changing the shared baseline.
  await sql('UPDATE "TaskInstance" SET date=NOW(),"shiftStart"=NOW()-interval \'1 minute\',"shiftEnd"=NOW(),"completedAt"=NOW(),"staffSubmittedAt"=NOW() WHERE id=$1', [fixture.task.transfer]);
  const snapshot = page.waitForResponse(response => new URL(response.url()).pathname === '/api/manager/operations/overview' && response.status() === 200);
  await enter(page, '/today-status');
  const data: OverviewResponse = (await (await snapshot).json()).data;
  const hourly = data.hourly ?? [];
  const number = (value: number) => value.toLocaleString('en-PK');
  expect(hourly.length).toBeGreaterThan(0);
  expect(data.metrics.submitted).toBeGreaterThan(0);
  expect(hourly.at(-1)!.due).toBe(data.metrics.totalTasks);
  expect(hourly.findLast(point => point.submitted !== null)!.submitted).toBe(data.metrics.submitted);
  expect(data.comparison.reduce((sum, row) => sum + row.tasks, 0)).toBe(data.metrics.totalTasks);
  expect(data.comparison.reduce((sum, row) => sum + row.submitted, 0)).toBe(data.metrics.submitted);
  const progress = page.getByRole('region', { name: 'Today’s task progress', exact: true });
  await expect(progress).toContainText(new RegExp(`${number(data.metrics.submitted)}\\s*/\\s*${number(data.metrics.totalTasks)}\\s*Work submitted`));
  await expect(progress.getByRole('img')).toHaveAccessibleName(`Work submitted: ${number(data.chart.submitted)}, In progress: ${number(data.chart.inProgress)}, Not started: ${number(data.chart.notStarted)}, Overdue: ${number(data.chart.overdue)}`);
  await expect(page.getByRole('region', { name: 'Team attendance', exact: true }).getByRole('img')).toHaveAccessibleName(`${number(data.metrics.present)} of ${number(data.metrics.scheduled)} scheduled staff checked in`);
  await page.getByText('View hourly figures', { exact: true }).filter({ visible: true }).click();
  const figures = page.getByRole('table', { name: 'View hourly figures' });
  await expect(figures.getByRole('row')).toHaveCount(hourly.length + 1);
  for (const [index, point] of hourly.entries()) {
    const row = figures.getByRole('row').nth(index + 1);
    await expect(row.getByRole('cell')).toHaveText([number(point.due), point.submitted === null ? 'Not recorded' : number(point.submitted)]);
  }
  await expect(page.getByRole('img', { name: 'Work through the day', exact: true })).toHaveAccessibleDescription(new RegExp(`${number(data.metrics.totalTasks)} tasks are due by the end of the day\\.`));
  const byLocation = page.getByRole('region', { name: 'By location', exact: true });
  for (const row of data.comparison) {
    const link = byLocation.getByRole('link', { name: `View daily records: ${row.location.name}`, exact: true });
    await expect(link).toBeVisible();
    const item = byLocation.getByRole('listitem').filter({ has: page.getByRole('link', { name: `View daily records: ${row.location.name}`, exact: true }) });
    await expect(item).toContainText(`${number(row.present)} of ${number(row.scheduled)} staff checked in`);
    if (row.tasks > 0) {
      const meter = link.getByRole('meter', { name: row.location.name, exact: true });
      await expect(meter).toHaveAttribute('aria-valuenow', String(row.submitted));
      await expect(meter).toHaveAttribute('aria-valuemax', String(row.tasks));
      await expect(meter).toHaveAttribute('aria-valuetext', `${number(row.submitted)} of ${number(row.tasks)}`);
    } else {
      await expect(link.getByRole('img', { name: `${row.location.name}: Not recorded`, exact: true })).toBeVisible();
      await expect(item).toContainText(`${number(row.submitted)} submitted · ${number(row.tasks)} due`);
    }
  }
});

test('W42 task QR opens on demand and task photo requirements remain inspectable', async ({ page }) => {
  const qrPath = `/api/task-instance/${fixture.review.taskId}/qr`;
  const qrReads: string[] = [];
  page.on('request', request => { if (/\/task-instance\/\d+\/qr$/.test(new URL(request.url()).pathname)) qrReads.push(request.url()); });
  await enter(page, `/today-status?taskId=${fixture.review.taskId}`);
  const panel = taskPanel(page); await expect(panel).toBeVisible(); expect(qrReads).toHaveLength(0);
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname === qrPath && response.request().method() === 'GET' && response.ok());
  await panel.getByRole('button', { name: 'Task QR', exact: true }).click();
  await loaded;
  const qr = panel.getByRole('region', { name: 'Task QR', exact: true }); await expect(qr).toBeVisible();
  await expect(qr.getByRole('img', { name: `QR for task ${fixture.review.taskId}`, exact: true })).toBeVisible();
  await page.goto(`/verification/${fixture.task.photos}`);
  await expect(page.getByRole('heading', { name: 'Task photos', exact: true })).toBeVisible();
  const views = page.getByRole('region', { name: 'Required photo views', exact: true });
  await expect(views).toContainText('0 of 1 required photos received');
  await views.getByRole('button').first().click(); await expect(page).toHaveURL(/view=/);
  await expect(page.getByRole('region', { name: 'Selected photo', exact: true })).toContainText('Show the sink basin');
  const selected = new URL(page.url()).searchParams.get('view'); await page.reload();
  await expect(page).toHaveURL(new RegExp('view=' + selected));
  await expect(page.getByRole('region', { name: 'Task and evidence status', exact: true })).toContainText('Not submitted');
});

test('W42 performance issue requires category and note and persists separately from verification', async ({ page }) => {
  await enter(page, `/exceptions/${fixture.review.id}`);
  await page.getByRole('radio', { name: 'Record staff performance issue', exact: true }).check();
  await page.getByRole('button', { name: 'Record issue and close review', exact: true }).click();
  await expect(page.getByLabel('Performance category', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Performance category', { exact: true }).selectOption('MISSING_PHOTOS');
  await page.getByRole('button', { name: 'Record issue and close review', exact: true }).click();
  await expect(page.getByLabel('Performance note', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  const before = await sql('SELECT status,"staffSubmittedAt","completionOutcome" FROM "TaskInstance" WHERE id=$1', [fixture.review.taskId]);
  await page.getByLabel('Performance note', { exact: true }).fill('W42 checked circumstances and recorded missing photos');
  await page.getByRole('button', { name: 'Record issue and close review', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Decision recorded', exact: true })).toContainText('W42 checked circumstances');
  await page.reload(); await expect(page.getByRole('region', { name: 'Decision recorded', exact: true })).toContainText('W42 checked circumstances');
  expect(await sql('SELECT status,"staffSubmittedAt","completionOutcome" FROM "TaskInstance" WHERE id=$1', [fixture.review.taskId])).toEqual(before);
  await page.goto('/exceptions?queue=resolved&period=all');
  await expect(page.getByRole('region', { name: 'Review queue', exact: true }).getByRole('link', { name: /E2E review room/ })).toBeVisible();
});

test('W42 attendance media stays lazy until a record opens and zoom closes before the record', async ({ page }) => {
  await sql('UPDATE "Attendance" SET "checkOutImage"="checkInImage","checkOutTime"=NOW(),status=\'CHECKED_OUT\' WHERE id=$1', [fixture.attendance.openShift]);
  const reads: string[] = [];
  const sharp = createRequire(new URL('../../backend/package.json', import.meta.url))('sharp');
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'white' } }).jpeg().toBuffer();
  // Only the private storage delivery boundary is simulated. Metadata, record
  // authorization and context are real API/database reads; no provider is used.
  await page.route('**/api/attendance/*/photos/*', route => {
    reads.push(route.request().url());
    return route.fulfill({ contentType: 'image/jpeg', body: bytes });
  });
  await enter(page, openShiftAttendancePath);
  const opener = page.getByRole('button', { name: 'Attendance context: E2E staff openShift', exact: true });
  await expect(opener).toBeVisible(); expect(reads).toHaveLength(0);
  await opener.click(); const record = page.getByRole('dialog', { name: /^Attendance context/ });
  await expect(record.getByRole('img', { name: 'Check-in photo', exact: true })).toBeVisible();
  await expect(record.getByRole('img', { name: 'Check-out photo', exact: true })).toBeVisible();
  expect(reads.map(url => new URL(url).pathname).sort()).toEqual(['check-in', 'check-out'].map(kind => `/api/attendance/${fixture.attendance.openShift}/photos/${kind}`));
  for (const kind of ['check-in', 'check-out']) {
    const enlarge = record.getByRole('button', { name: `Enlarge ${kind} photo`, exact: true });
    await enlarge.click();
    const zoom = page.getByRole('dialog', { name: kind === 'check-in' ? 'Check-in photo' : 'Check-out photo', exact: true });
    await expect(zoom.getByRole('img')).toBeVisible();
    // Radix hides the underlying modal from assistive technology during zoom.
    await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(2);
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(zoom).toHaveCount(0); await expect(record).toBeVisible(); await expect(enlarge).toBeFocused();
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(opener).toBeFocused();
  expect(reads).toHaveLength(2);
});

test('W42 area template can be added, edited and archived with history retained', async ({ page }) => {
  await enter(page, `/locations/${fixture.site.A}?tab=areas&newArea=1`);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Area name', { exact: true }).fill('W42 lifecycle room');
  await dialog.getByRole('button', { name: 'Create area template', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Edit area template', exact: true })).toBeVisible();
  await dialog.getByLabel('Area name', { exact: true }).fill('W42 edited lifecycle room');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog.getByLabel('Area name', { exact: true })).toHaveValue('W42 edited lifecycle room');
  await expect(dialog.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
  const areaId = new URL(page.url()).searchParams.get('area');
  expect(areaId).toMatch(/^\d+$/);
  // Hold the real archive read-back to exercise the pending-dismissal guard
  // even when the database write has already committed. No response is mocked.
  let releaseRefresh!: () => void;
  const refresh = new Promise<void>(resolve => { releaseRefresh = resolve; });
  await page.route(`**/api/area/${areaId}`, async route => {
    await refresh;
    await route.continue();
  });
  await dialog.getByRole('button', { name: 'Archive template', exact: true }).click();
  try {
    await dialog.getByRole('button', { name: 'Confirm archive', exact: true }).click();
    await expect.poll(async () => (await sql('SELECT status FROM "Area" WHERE name=$1', ['W42 edited lifecycle room']))[0]?.status).toBe('ARCHIVED');
    await expect(dialog.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`[?&]area=${areaId}(?:&|$)`));
  } finally {
    releaseRefresh();
  }
  await expect(dialog.getByRole('button', { name: 'Save changes', exact: true })).toHaveAttribute('aria-busy', 'false');
  await expect(dialog.getByText('Archived', { exact: true })).toBeVisible();
  // SQL persistence precedes the end of the guarded refresh. Close only once
  // the UI has settled, and verify navigation before reloading its saved URL.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&](?:area|newArea)=/);
  await page.reload();
  await expect(dialog).toHaveCount(0);
  await choose(page, 'Area status', 'Archived');
  await expect(page.getByRole('row', { name: /W42 edited lifecycle room/ })).toBeVisible();
});

for (const overnight of [false, true]) test(`W42 cleaning schedule ${overnight ? 'overnight' : 'daytime'} persists in the week view`, async ({ page }) => {
  await sql('UPDATE "Staff" SET "shiftStart"=$2,"shiftEnd"=$3 WHERE id=$1', [fixture.staff.recovery.id, overnight ? '1970-01-01T15:00:00Z' : '1970-01-01T03:00:00Z', overnight ? '1970-01-01T03:00:00Z' : '1970-01-01T13:00:00Z']);
  await enter(page, `/locations/${fixture.site.A}?tab=templates&newSchedule=1`);
  const dialog = page.getByRole('dialog'); const title = overnight ? 'W42 overnight clean' : 'W42 daytime clean';
  await dialog.getByLabel('Task title', { exact: true }).fill(title);
  await dialog.getByLabel('Area template', { exact: true }).selectOption({ label: 'E2E review room' });
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await dialog.getByLabel('Assign staff', { exact: true }).selectOption(String(fixture.staff.recovery.id));
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await dialog.getByLabel('Start time', { exact: false }).fill(overnight ? '22:00' : '09:00');
  await dialog.getByLabel('End time', { exact: false }).fill(overnight ? '06:00' : '10:00');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/task-template' && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Create schedule', exact: true }).click();
  const savedResponse = await created;
  expect(savedResponse.status(), JSON.stringify(await savedResponse.json())).toBe(201);
  await expect(dialog).toHaveCount(0);
  await page.reload();
  const tab = cleaningSchedules(page);
  await tab.getByRole('group', { name: 'View', exact: true }).getByRole('button', { name: 'Week', exact: true }).click();
  const week = tab.getByRole('table', { name: 'Week', exact: true });
  const worker = week.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /^E2E staff recovery/ }) });
  const occurrence = scheduleButton(worker, title).first();
  await expect(occurrence).toBeVisible();
  if (overnight) {
    await occurrence.click();
    await expect(scheduleDetails(page, title)).toContainText('22:00–06:00 · 8 h');
    await page.goto(`/locations/${fixture.site.A}?tab=schedule`);
    await expect(page.getByRole('button', { name: new RegExp(title + '.*Continues into next day') }).first()).toBeVisible();
  }
  const [saved] = await sql('SELECT "shiftStart","shiftEnd" FROM "TaskTemplate" WHERE title=$1', [title]);
  // Templates retain local clock fields; occurrence generation interprets an
  // end clock before the start clock as the following day.
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit' });
  expect(clock.format(new Date(saved.shiftStart))).toBe(overnight ? '22:00' : '09:00');
  expect(clock.format(new Date(saved.shiftEnd))).toBe(overnight ? '06:00' : '10:00');
  const day = 24 * 3600000;
  expect((new Date(saved.shiftEnd).getTime() - new Date(saved.shiftStart).getTime() + day) % day).toBe((overnight ? 8 : 1) * 3600000);
});

test('W42 add a team member then transfer site preserves their attendance and task history', async ({ page }) => {
  await capacity(); await enter(page, '/staff?create=1'); const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Full Name', { exact: true }).fill('New Transfer Worker');
  await dialog.getByLabel('Email (optional)', { exact: true }).fill('w42-member@example.invalid');
  await dialog.getByLabel('Phone Number', { exact: true }).fill('+923001234567');
  await choose(page, 'Location (optional)', 'E2E site A', 'en', dialog);
  await dialog.getByLabel('Shift Start', { exact: true }).fill('09:00');
  await dialog.getByLabel('Shift End', { exact: true }).fill('17:00');
  await dialog.getByRole('button', { name: 'Create staff', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('New Transfer Worker', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  const [person] = await sql('SELECT id FROM "Staff" WHERE email=$1', ['w42-member@example.invalid']);
  const [history] = await sql('INSERT INTO "TaskInstance" (title,date,"shiftStart","shiftEnd","staffId","locationId","updatedAt") VALUES (\'W42 retained history\',NOW(),NOW(),NOW()+interval \'1 hour\',$1,$2,NOW()) RETURNING id', [person.id, fixture.site.A]);
  const [attendance] = await sql('INSERT INTO "Attendance" ("staffId","locationId",date,"expectedStart","expectedEnd","checkInTime","checkOutTime",status,"updatedAt") VALUES ($1,$2,NOW(),NOW()-interval \'1 hour\',NOW(),NOW()-interval \'1 hour\',NOW()-interval \'30 minutes\',\'CHECKED_OUT\',NOW()) RETURNING id', [person.id, fixture.site.A]);
  await page.goto(`/staff/${person.id}`);
  await page.getByRole('button', { name: 'Staff access', exact: true }).click();
  await dialog.getByLabel('Action', { exact: true }).selectOption('transfer');
  await choose(page, 'Destination site', 'E2E site B', 'en', dialog);
  await dialog.getByLabel('Reason', { exact: true }).fill('W42 requested move with history retained');
  await dialog.getByRole('button', { name: 'Confirm access change', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.reload(); await expect(page.getByRole('main')).toContainText('E2E site B');
  expect((await sql('SELECT "locationId" FROM "Staff" WHERE id=$1', [person.id]))[0].locationId).toBe(fixture.site.B);
  expect((await sql('SELECT "locationId" FROM "TaskInstance" WHERE id=$1', [history.id]))[0].locationId).toBe(fixture.site.A);
  expect((await sql('SELECT "locationId" FROM "Attendance" WHERE id=$1', [attendance.id]))[0].locationId).toBe(fixture.site.A);
});

test('W42 staff profile period, tab and attendance record survive reload', async ({ page }) => {
  await enter(page, `/staff/${fixture.staff.legacy.id}?tab=attendance&dateFrom=2020-01-01&dateTo=2090-01-01`);
  await expect(page.getByRole('tab', { name: 'Attendance', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.reload(); await expect(page).toHaveURL(/dateFrom=2020-01-01/);
  const opener = page.getByRole('button', { name: 'Attendance context', exact: true });
  await opener.click(); await expect(page.getByRole('dialog')).toContainText('Original captured facts');
  await page.keyboard.press('Escape'); await expect(opener).toBeFocused();
  await page.getByRole('tab', { name: 'Task history', exact: true }).click(); await page.reload();
  await expect(page.getByRole('tab', { name: 'Task history', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/dateTo=2090-01-01/); await noOverflow(page);
});

test('W42 manager creation disables taken locations and persists an available assignment', async ({ page }) => {
  await capacity();
  const [site] = await sql('INSERT INTO "Location" ("companyId",name,address,latitude,longitude,timezone,"updatedAt") VALUES ($1,\'W42 free site\',\'Synthetic assignment site\',\'31\',\'74\',\'Asia/Karachi\',NOW()) RETURNING id', [fixture.company.A]);
  await enter(page, '/managers'); await page.getByRole('button', { name: 'Add manager', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('checkbox', { name: 'E2E site A', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('checkbox', { name: 'E2E site B', exact: true })).toBeDisabled();
  await dialog.getByLabel('Manager Name', { exact: true }).fill('W42 new manager');
  await dialog.getByLabel('Email', { exact: true }).fill('w42-manager@example.invalid');
  await dialog.getByLabel('Password', { exact: true }).fill(fixture.password);
  await dialog.getByRole('checkbox', { name: 'W42 free site', exact: true }).check();
  await dialog.getByRole('button', { name: 'Create manager', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.reload(); await expect(page.getByRole('row', { name: /W42 new manager/ })).toContainText('W42 free site');
  const assignments = await sql('SELECT ml."locationId" FROM "ManagerLocation" ml JOIN "Manager" m ON m.id=ml."managerId" WHERE m.email=$1', ['w42-manager@example.invalid']);
  expect(assignments).toEqual([{ locationId: site.id }]);
});
