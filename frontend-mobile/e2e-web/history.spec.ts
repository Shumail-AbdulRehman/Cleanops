import { at, button, expect, tab, test, words } from './support/test';
import { fail, fixture, ok, type Call } from './support/api';

// History: tasks by month with filters and finished task details (specs 41, 43, 47, 51), the
// attendance calendar and day sheet (specs 42, 47, 51), and an older server without the routes (spec 17).

const LATE_ORANGE = 'rgb(240, 138, 60)';
const YELLOW = 'rgb(255, 210, 31)';

type Item = { id: number; status: string };
const historyFor = (call: Call) => {
  const body = fixture('history') as { data: { items: Item[]; month: string } };
  const filter = call.query.filter ?? 'all';
  const keep: Record<string, string[]> = { verified: ['VERIFIED', 'ACCEPTED_WITH_EXCEPTIONS'], waiting: ['WAITING_FOR_REVIEW', 'SUBMITTED'], missed: ['MISSED'] };
  if (call.query.month && call.query.month !== '2026-11') return ok({ ...body.data, month: call.query.month, counts: { verified: 0, waiting: 0, missed: 0, total: 0 }, items: [] });
  return ok({ ...body.data, items: filter === 'all' ? body.data.items : body.data.items.filter(item => keep[filter].includes(item.status)) });
};

async function openHistory(page: import('@playwright/test').Page) {
  await tab(page, 'History').click();
  await expect(page.getByRole('heading', { name: 'November 2026' })).toBeVisible();
}

test.describe('tasks', () => {
  test.beforeEach(async ({ page, api, open }) => {
    api.on('GET', '/staff/mobile/history', historyFor);
    await open({ now: at('06:00') });
    await openHistory(page);
  });

  test('month summary counts each state and the list names each task', async ({ page, api }) => {
    expect(api.callsTo('/staff/mobile/history')[0].query).toMatchObject({ month: '2026-11', filter: 'all' });
    for (const label of ['Verified 1', 'Waiting 1', 'Missed 1']) await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Staff kitchen, Verified, / })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Meeting room, Waiting for review, / })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Back stairs, Missed, / })).toBeVisible();
    await expect(page.getByText('Yesterday', { exact: true })).toBeVisible();
  });

  test('a filter changes the list; another month changes the request', async ({ page, api }) => {
    await button(page, 'Missed').click();
    await expect(page.getByRole('button', { name: /^Back stairs, Missed, / })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Staff kitchen, / })).toHaveCount(0);
    expect(api.callsTo('/staff/mobile/history').at(-1)!.query).toMatchObject({ filter: 'missed' });
    await button(page, 'Waiting').click();
    await expect(page.getByRole('button', { name: /^Meeting room, / })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Back stairs, / })).toHaveCount(0);
    await button(page, 'All').click();
    await button(page, 'Previous month').click();
    await expect(page.getByRole('heading', { name: 'October 2026' })).toBeVisible();
    expect(api.callsTo('/staff/mobile/history').at(-1)!.query).toMatchObject({ month: '2026-10' });
    await expect(page.getByText('No finished tasks this month.')).toBeVisible();
    await button(page, 'Next month').click();
    await expect(page.getByRole('heading', { name: 'November 2026' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next month' })).toHaveCount(0);
  });

  test('finished task details keep Submitted, Verified and Review closed separate', async ({ page }) => {
    await page.getByRole('button', { name: /^Meeting room, / }).click();
    await expect(page.getByText('Task details').last()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What happened' })).toBeVisible();
    const fact = (label: string) => page.getByText(label, { exact: true }).last().locator('xpath=../..');
    await expect(fact('Submitted')).toContainText('Yes');
    await expect(fact('Verified')).toContainText('Not yet');
    await expect(fact('Review closed')).toContainText('Not yet');
    await expect(page.getByText('Submitted means you finished. Verified means your manager or the check confirmed it.')).toBeVisible();
    await button(page, 'Back').click();
    await page.getByRole('button', { name: /^Staff kitchen, / }).click();
    await expect(fact('Submitted')).toContainText('Yes');
    await expect(fact('Verified')).not.toContainText('Not yet');
    await expect(fact('Review closed')).toContainText('Yes');
    await button(page, 'Back').click();
    await page.getByRole('button', { name: /^Back stairs, / }).click();
    await expect(fact('Submitted')).toContainText('Not done');
    await expect(fact('Verified')).toContainText('Not yet');
  });
});

test.describe('attendance', () => {
  test.beforeEach(async ({ page, open }) => {
    await open({ now: at('06:00') });
    await openHistory(page);
    await page.getByRole('tab', { name: 'Attendance', exact: true }).click();
    await expect(page.getByLabel('10 November, Late', { exact: true })).toBeVisible();
  });

  test('calendar: late is orange and no day is yellow', async ({ page, api }) => {
    expect(api.callsTo('/staff/mobile/attendance/month')[0].query).toMatchObject({ month: '2026-11' });
    const fill = (label: string) => page.getByLabel(label, { exact: true }).evaluate(element => getComputedStyle(element).backgroundColor);
    expect(await fill('10 November, Late')).toBe(LATE_ORANGE);
    const colours = await page.locator('[aria-label$=" November"], [aria-label*=" November, "]').evaluateAll(cells => cells.map(cell => getComputedStyle(cell).backgroundColor));
    expect(colours.length).toBe(30);
    expect(colours).not.toContain(YELLOW);
    for (const label of ['On time 2', 'Late 1', 'Absent 1', 'Missed check-out 1']) await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  });

  test('a day opens its sheet with the times', async ({ page }) => {
    await page.getByRole('button', { name: /Late$/ }).click();
    await expect(page.getByText(words('Late by 22 min'))).toBeVisible();
    const sheet = page.getByText(words('Late by 22 min')).locator('xpath=ancestor::*[.//*[text()="Location"]][1]');
    await expect(sheet).toContainText('9:22 AM');
    await expect(sheet).toContainText('5:05 PM');
    await expect(sheet).toContainText(words('9:00 AM – 5:00 PM', false));
    await expect(sheet).toContainText('Head Office');
    await button(page, 'Close').click();
    await expect(page.getByText(words('Late by 22 min'))).toBeHidden();
  });
});

test('older server without History (404): error with retry, no crash', async ({ page, api, open }) => {
  api.on('GET', '/staff/mobile/history', fail(404, 'Route not found'));
  api.on('GET', '/staff/mobile/attendance/month', fail(404, 'Route not found'));
  api.on('GET', '/staff/mobile/profile', fail(404, 'Route not found'));
  await open({ now: at('06:00') });
  await openHistory(page);
  await expect(page.getByText('Something could not load').last()).toBeVisible();
  await expect(button(page, 'Try again')).toBeVisible();
  // A 404 is never retried on its own.
  expect(api.callsTo('/staff/mobile/history')).toHaveLength(1);
  await button(page, 'Try again').click();
  await expect.poll(() => api.callsTo('/staff/mobile/history').length).toBe(2);
  await page.getByRole('tab', { name: 'Attendance', exact: true }).click();
  await expect(page.getByText('Something could not load').last()).toBeVisible();
  await tab(page, 'Profile').click();
  await expect(page.getByText('Figures could not load.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Settings and help' })).toBeVisible();
});
