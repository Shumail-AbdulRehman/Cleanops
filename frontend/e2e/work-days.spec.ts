import type { Locator, Page, Request } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { enter, expect, fixture, test } from './fixtures';
import { addScheduleButton, choose, cleaningSchedules, copy, scheduleButton, scheduleDetails, ui } from './workspace-helpers';
import { translate } from '../src/i18n/translations';

type Language = 'en' | 'ur';
const owner = 'ownerworkDays';
const site = 'E2E work days site';
const everyDayWorker = 'Every Day Worker';
const dayOffWorker = 'Day Off Worker';
const fixedTuesday = 'E2E Fixed Tuesday';
const dailySchedule = 'E2E Daily';
const newStaff = 'Nadia Example';
const chosenSchedule = 'E2E Chosen Days';
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
type Day = typeof weekdays[number];
const location = `/locations/${fixture.site.workDays}`;
const templates = `${location}?tab=templates&week=${fixture.workDays.week}`;
const today = `/today-status?tab=staff&locationId=${fixture.site.workDays}&date=${fixture.workDays.today}#daily-records`;
const screens = new URL('./.artifacts/evidence/work-days/', import.meta.url);

test.use({ timezoneId: 'Asia/Karachi', viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ context }) => {
  await context.route(/^https?:\/\//, route =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

test.afterEach(async ({ page }) => {
  await expect(page.getByText(/Request failed with status code/i)).toHaveCount(0);
});

const button = (scope: Page | Locator, name: string | RegExp) => scope.getByRole('button', { name, exact: true });
const namedRow = (scope: Page | Locator, name: string) =>
  scope.getByRole('row').filter({ hasText: name });
const pane = (page: Page) => page.getByRole('dialog');
const dayGroup = (scope: Page | Locator, label: 'Work days' | 'Repeat on', language: Language) =>
  scope.getByRole('group', { name: copy(label, language), exact: true });
const dayChip = (group: Locator, day: Day, language: Language) => button(group, copy(day, language));
const isRequest = (request: Request, method: string, path: string) =>
  request.method() === method && new URL(request.url()).pathname === path;

async function selectDays(group: Locator, days: readonly Day[], language: Language) {
  for (const day of weekdays) {
    const chip = dayChip(group, day, language);
    const pressed = String(days.includes(day));
    if (await chip.getAttribute('aria-pressed') !== pressed) await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', pressed);
  }
}

async function createStaffForm(page: Page, language: Language = 'en') {
  await enter(page, '/staff', owner, language);
  await button(page, copy('Add team member', language)).click();
  const dialog = pane(page);
  await dialog.getByLabel(copy('Full Name', language), { exact: true }).fill(newStaff);
  await dialog.getByLabel(copy('Phone Number', language), { exact: true }).fill('03981000010');
  await choose(page, 'Location (optional)', site, language, dialog);
  await dialog.getByLabel(copy('Shift Start', language), { exact: true }).fill('09:00');
  await dialog.getByLabel(copy('Shift End', language), { exact: true }).fill('17:00');
  return dialog;
}

async function openStaffEdit(page: Page, language: Language) {
  await button(page, `${copy('Actions', language)}: ${everyDayWorker}`).click();
  await page.getByRole('menuitem', { name: copy('Edit', language), exact: true }).click();
  return pane(page);
}

async function showConflict(page: Page, language: Language = 'en') {
  await enter(page, '/staff', owner, language);
  const dialog = await openStaffEdit(page, language);
  const group = dayGroup(dialog, 'Work days', language);
  await dayChip(group, 'Tuesday', language).click();
  const request = page.waitForResponse(response =>
    isRequest(response.request(), 'PATCH', `/api/staff/${fixture.staff.everyDay.id}`));
  await button(dialog, copy('Save changes', language)).click();
  const response = await request;
  expect(response.status()).toBe(409);
  expect((await response.json()).errors[0]).toMatchObject({ code: 'WORK_DAYS_CONFLICT', field: 'workDays' });
  const message = translate(
    'This person has schedules on the days you removed: {titles}. Change those schedules first.',
    language, { titles: `"${fixedTuesday}"` },
  );
  await expect(group).toHaveAttribute('aria-invalid', 'true');
  await expect(group).toHaveAccessibleDescription(message);
  await expect(dialog.getByText(message, { exact: true })).toBeVisible();
  await expect(dayChip(group, 'Tuesday', language)).toHaveAttribute('aria-pressed', 'false');
  return dialog;
}

async function openRepeatStep(page: Page, title: string, language: Language, staffId?: number) {
  await enter(page, templates, owner, language);
  await addScheduleButton(page, language).click();
  const dialog = pane(page);
  await dialog.getByLabel(ui('Task title')).fill(title);
  await dialog.getByLabel(ui('Area template')).selectOption({ label: fixture.workDays.area });
  const next = button(dialog, copy('Next', language));
  await next.click();
  if (staffId) await dialog.getByLabel(ui('Assign staff')).selectOption(String(staffId));
  await next.click();
  const recurrence = dialog.getByLabel(copy('Recurrence', language), { exact: true });
  await expect(recurrence).toBeVisible();
  return { dialog, recurrence, next };
}

async function fillScheduleWindow(dialog: Locator, language: Language) {
  await dialog.getByLabel(copy('Effective from', language), { exact: true }).fill(fixture.workDays.week);
  await dialog.getByLabel(new RegExp(ui('Start time').source.slice(0, -1))).fill('10:00');
  await dialog.getByLabel(new RegExp(ui('End time').source.slice(0, -1))).fill('11:00');
}

async function expectWeek(page: Page, title: string, occupied: readonly number[]) {
  const tab = cleaningSchedules(page);
  await button(tab.getByRole('group', { name: 'View', exact: true }), 'Week').click();
  const week = tab.getByRole('table', { name: 'Week', exact: true });
  const row = week.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /^Unassigned/ }) });
  const cells = row.getByRole('cell');
  await expect(cells).toHaveCount(7);
  for (const [day, cell] of (await cells.all()).entries()) {
    await expect(scheduleButton(cell, title)).toHaveCount(occupied.includes(day) ? 1 : 0);
  }
  await button(tab.getByRole('group', { name: 'View', exact: true }), 'List').click();
}

async function capture(page: Page, anchor: Locator, screen: string, width: number, language: Language) {
  await mkdir(screens, { recursive: true });
  await anchor.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: fileURLToPath(new URL(`${screen}-${width}-${language}.png`, screens)),
    animations: 'disabled',
  });
}

test('owner creates a Monday and Wednesday staff member and the list and overview persist it', async ({ page }) => {
  const dialog = await createStaffForm(page);
  const group = dayGroup(dialog, 'Work days', 'en');
  await expect(group.getByRole('button', { pressed: true })).toHaveCount(7);
  await selectDays(group, ['Monday', 'Wednesday'], 'en');
  const save = page.waitForResponse(response => isRequest(response.request(), 'POST', '/api/staff/create-staff'));
  await button(dialog, 'Create staff').click();
  const response = await save;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON().workDays).toEqual(['MON', 'WED']);
  await expect(dialog).toBeHidden();
  await page.reload();
  const row = namedRow(page, newStaff);
  await expect(row).toContainText('09:00–17:00 · Mon, Wed');
  await row.getByRole('link', { name: newStaff, exact: true }).click();
  const profile = page.getByRole('region', { name: 'Profile', exact: true });
  await expect(profile.getByText('Work days', { exact: true })).toBeVisible();
  await expect(profile.getByRole('definition').filter({ hasText: /^Mon, Wed$/ })).toBeVisible();
});

test('an empty workweek is rejected before a create request', async ({ page }) => {
  const dialog = await createStaffForm(page);
  const group = dayGroup(dialog, 'Work days', 'en');
  await selectDays(group, [], 'en');
  const saves: Request[] = [];
  page.on('request', request => {
    if (isRequest(request, 'POST', '/api/staff/create-staff')) saves.push(request);
  });
  await button(dialog, 'Create staff').click();
  const message = 'Choose at least one work day.';
  await expect(group).toHaveAccessibleDescription(message);
  await expect(dialog.getByText(message, { exact: true })).toBeVisible();
  expect(saves).toHaveLength(0);
});

test('removing Tuesday conflicts with the fixed schedule and keeps the saved days', async ({ page }) => {
  await showConflict(page);
  await page.reload();
  const reopened = await openStaffEdit(page, 'en');
  await expect(dayGroup(reopened, 'Work days', 'en').getByRole('button', { pressed: true })).toHaveCount(7);
});

test('a chosen-days schedule persists and shows bars only on Monday and Wednesday', async ({ page }) => {
  const { dialog, recurrence, next } = await openRepeatStep(page, chosenSchedule, 'en');
  await recurrence.selectOption('CHOSEN');
  await selectDays(dayGroup(dialog, 'Repeat on', 'en'), ['Monday', 'Wednesday'], 'en');
  await fillScheduleWindow(dialog, 'en');
  await next.click();
  await expect(dialog.getByText(new RegExp(`^Repeats on Mon, Wed from ${fixture.workDays.week}`))).toBeVisible();
  const save = page.waitForResponse(response => isRequest(response.request(), 'POST', '/api/task-template'));
  await button(dialog, 'Create schedule').click();
  const response = await save;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON()).toMatchObject({ recurringType: 'DAILY', repeatDays: ['MON', 'WED'] });
  await expect(dialog).toBeHidden();
  await page.reload();
  await expectWeek(page, chosenSchedule, [0, 2]);
  await page.goto(`${location}?tab=schedule&week=${fixture.workDays.week}`);
  await expect(page.getByRole('button', { name: /^E2E Chosen Days/ })).toHaveCount(2);
});

test('the wizard matches Daily to the fixed worker’s Monday and Wednesday workweek', async ({ page }) => {
  const name = 'Monday Wednesday Worker';
  const { dialog, recurrence } = await openRepeatStep(page, chosenSchedule, 'en', fixture.staff.mondayWednesday.id);
  await expect(recurrence).toHaveValue('CHOSEN');
  const group = dayGroup(dialog, 'Repeat on', 'en');
  await expect(group.getByRole('button', { pressed: true })).toHaveCount(2);
  await expect(dayChip(group, 'Monday', 'en')).toHaveAttribute('aria-pressed', 'true');
  await expect(dayChip(group, 'Wednesday', 'en')).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByText(`Matched to ${name}'s work days.`, { exact: true })).toBeVisible();
});

test('the wizard rejects Tuesday for a Monday-only fixed worker without saving', async ({ page }) => {
  const rejected = 'E2E Incompatible Schedule';
  const { dialog, next } = await openRepeatStep(page, rejected, 'en', fixture.staff.monday.id);
  const group = dayGroup(dialog, 'Repeat on', 'en');
  await selectDays(group, ['Tuesday'], 'en');
  await fillScheduleWindow(dialog, 'en');
  const saves: Request[] = [];
  page.on('request', request => {
    if (isRequest(request, 'POST', '/api/task-template')) saves.push(request);
  });
  await next.click();
  const message = 'Monday Worker works Mon. Choose days within those, or use automatic assignment.';
  await expect(group).toHaveAccessibleDescription(message);
  await expect(dialog.getByText(message, { exact: true })).toBeVisible();
  expect(saves).toHaveLength(0);
  await page.reload();
  await expect(page.getByText(rejected, { exact: true })).toHaveCount(0);
});

test('editing a Daily schedule to Tuesday updates the week and recurrence pill', async ({ page }) => {
  await enter(page, templates, owner);
  const row = scheduleButton(cleaningSchedules(page), dailySchedule);
  await row.click();
  await button(scheduleDetails(page, dailySchedule), 'Edit schedule').click();
  const dialog = page.getByRole('dialog', { name: 'Edit cleaning schedule', exact: true });
  await dialog.getByLabel('Recurrence', { exact: true }).selectOption('CHOSEN');
  await selectDays(dayGroup(dialog, 'Repeat on', 'en'), ['Tuesday'], 'en');
  await button(dialog, 'Save changes').click();
  await expect(dialog).toBeHidden();
  await expectWeek(page, dailySchedule, [1]);
  await expect(row.getByText('Tue', { exact: true })).toBeVisible();
});

test('Today displays and filters staff who are off separately from missing attendance', async ({ page }) => {
  await enter(page, today, owner);
  const register = page.getByRole('region', { name: 'Daily records', exact: true });
  const row = namedRow(register, dayOffWorker);
  await expect(row.getByText('Day off', { exact: true })).toBeVisible();
  const filter = register.getByRole('group', { name: 'Attendance', exact: true });
  const waitForFilter = (value: string) => page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/manager/operations/staff' && url.searchParams.get('attendance') === value;
  });
  const off = waitForFilter('off');
  await button(filter, 'Day off').click();
  expect((await off).ok()).toBe(true);
  await expect(namedRow(register, dayOffWorker)).toBeVisible();
  const missing = waitForFilter('missing');
  await button(filter, 'No attendance record').click();
  await expect(page).toHaveURL(/attendance=missing/);
  expect((await missing).ok()).toBe(true);
  await expect(namedRow(register, dayOffWorker)).toHaveCount(0);
});

async function upload(dialog: Locator, rows: string[]) {
  await dialog.getByLabel(/Completed spreadsheet/).setInputFiles({
    name: 'staff-work-days.csv', mimeType: 'text/csv', buffer: Buffer.from(rows.join('\n') + '\n'),
  });
}

const csvHeader = 'Full Name,Phone,Email,Shift Start,Shift End';
const values = [
  'Mona Example,03981000011,,09:00,17:00,"Mon,Wed"',
  'Hina Example,03981000012,,09:00,17:00,',
];

test('a Work days spreadsheet rejects Funday and saves the two corrected rows', async ({ page }) => {
  await enter(page, `${location}?tab=staff`, owner);
  await button(page, 'Import Staff').click();
  const dialog = pane(page);
  const header = csvHeader + ',Work days';
  await upload(dialog, [header, ...values, 'Amna Example,03981000013,,09:00,17:00,Funday']);
  const invalid = namedRow(dialog, 'Amna Example');
  await expect(invalid.getByText('Enter work days like Mon,Wed using Mon to Sun.', { exact: true })).toBeVisible();
  await expect(button(dialog, 'Confirm Import')).toBeDisabled();
  await upload(dialog, [header, ...values]);
  await button(dialog, 'Confirm Import').click();
  await expect(dialog.getByText(/2 employees imported into/)).toBeVisible();
  await button(dialog, 'Done').click();
  await page.goto('/staff');
  await expect(namedRow(page, 'Mona Example')).toContainText('09:00–17:00 · Mon, Wed');
  const defaultWorker = namedRow(page, 'Hina Example');
  await expect(defaultWorker).toContainText('09:00–17:00 · Asia/Karachi');
  await defaultWorker.getByRole('link', { name: 'Hina Example', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Profile', exact: true }).getByText('Every day', { exact: true })).toBeVisible();
});

test('the old five-column CSV imports an every-day worker', async ({ page }) => {
  await enter(page, `${location}?tab=staff`, owner);
  await button(page, 'Import Staff').click();
  const dialog = pane(page);
  await upload(dialog, [csvHeader, 'Leena Example,03981000014,,09:00,17:00']);
  await button(dialog, 'Confirm Import').click();
  await expect(dialog.getByText(/1 employees imported into/)).toBeVisible();
  await button(dialog, 'Done').click();
  await page.reload();
  await namedRow(page, 'Leena Example').getByRole('link', { name: 'View worker', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Profile', exact: true }).getByText('Every day', { exact: true })).toBeVisible();
});

test('default data keeps the shift without a suffix and the Daily schedule has seven bars', async ({ page }) => {
  await enter(page, '/staff', owner);
  const row = namedRow(page, everyDayWorker);
  await expect(row).toContainText('09:00–17:00 · Asia/Karachi');
  await page.goto(templates);
  await expectWeek(page, dailySchedule, [0, 1, 2, 3, 4, 5, 6]);
  const registerRow = scheduleButton(cleaningSchedules(page), dailySchedule);
  await expect(registerRow.getByText('Every day', { exact: true })).toBeVisible();
});

for (const width of [1440, 390]) {
  for (const language of ['en', 'ur'] as const) {
    test(`work-days design captures at ${width}px (${language})`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      const create = await createStaffForm(page, language);
      const workDays = dayGroup(create, 'Work days', language);
      await selectDays(workDays, ['Monday', 'Wednesday'], language);
      await capture(page, workDays, 'staff-create', width, language);

      const edit = await showConflict(page, language);
      await capture(page, dayGroup(edit, 'Work days', language), 'staff-edit-conflict', width, language);

      const { dialog, recurrence } = await openRepeatStep(page, chosenSchedule, language);
      await recurrence.selectOption('CHOSEN');
      const repeatDays = dayGroup(dialog, 'Repeat on', language);
      await selectDays(repeatDays, ['Monday', 'Wednesday'], language);
      await fillScheduleWindow(dialog, language);
      await capture(page, repeatDays, 'schedule-wizard', width, language);

      await page.goto(templates);
      const tab = cleaningSchedules(page, language);
      await button(tab.getByRole('group', { name: copy('View', language), exact: true }), copy('Week', language)).click();
      if (width === 390) await tab.getByRole('button', { name: new RegExp(`^${copy('Tuesday', language)} `) }).click();
      const occurrence = scheduleButton(tab, fixedTuesday);
      await expect(occurrence).toHaveCount(1);
      await capture(page, occurrence, 'templates', width, language);

      await page.goto(today);
      const status = namedRow(page, dayOffWorker).getByText(copy('Day off', language), { exact: true });
      await expect(status).toBeVisible();
      await capture(page, status, 'today-day-off', width, language);
    });
  }
}
