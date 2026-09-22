import { at, button, expect, tab, test, words } from './support/test';
import { attendance, checkedIn, feed, shift, submittedAt, task } from './support/data';

// Tasks tab groups and badge (specs 06, 25, 32, 48) and Task details with its one next action (spec 33).

const YELLOW = 'rgb(255, 210, 31)';
const BLUE = 'rgb(37, 86, 216)';

async function badgeColour(page: import('@playwright/test').Page, count: string) {
  const badge = tab(page, 'Tasks').getByText(count, { exact: true });
  await expect(badge).toBeVisible();
  return badge.evaluate(element => getComputedStyle(element).backgroundColor);
}

test('groups: Needs you, To do and Done today, in that order', async ({ page, api, open }) => {
  api.on('GET', '/staff/mobile/attendance', attendance(checkedIn()));
  api.on('GET', '/staff/mobile/tasks', feed(
    task(501, 'Ground floor washroom'),
    task(502, 'Reception lobby', { status: 'IN_PROGRESS', verificationState: 'REWORK_REQUIRED', shiftStart: '2026-11-12T06:00:00.000Z' }),
    task(503, 'Staff kitchen', { staffSubmittedAt: submittedAt, shiftStart: '2026-11-12T04:30:00.000Z' }),
  ));
  await open({ now: at('05:30') });
  await tab(page, 'Tasks').click();
  await expect(page.getByText("Today's work").last()).toBeVisible();
  await expect(page.getByText(words('1 of 3 submitted')).first()).toBeVisible();
  const heads = ['Needs you', 'To do', 'Done today'].map(name => page.getByRole('heading', { name, exact: true }));
  const rows = ['Reception lobby', 'Ground floor washroom', 'Staff kitchen'].map(name => page.getByRole('button', { name: new RegExp(`^${name}, `) }));
  const top = async (locator: import('@playwright/test').Locator) => (await locator.boundingBox())!.y;
  for (let i = 0; i < 3; i += 1) {
    await expect(heads[i]).toBeVisible();
    expect(await top(rows[i])).toBeGreaterThan(await top(heads[i]));
    if (i > 0) expect(await top(heads[i])).toBeGreaterThan(await top(rows[i - 1]));
  }
  await expect(rows[0]).toHaveAccessibleName(/Retake photo/);
  await expect(rows[2]).toHaveAccessibleName(/Submitted/);
  // A task needs the person, so the badge (open tasks: 2) is yellow.
  expect(await badgeColour(page, '2')).toBe(YELLOW);
});

test('badge is blue when nothing needs the person', async ({ page, api, open }) => {
  api.on('GET', '/staff/mobile/attendance', attendance(checkedIn()));
  api.on('GET', '/staff/mobile/tasks', feed(task(501, 'Ground floor washroom'), task(502, 'Reception lobby')));
  await open({ now: at('04:30') });
  await tab(page, 'Tasks').click();
  await expect(page.getByRole('heading', { name: 'To do', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Needs you', exact: true })).toHaveCount(0);
  expect(await badgeColour(page, '2')).toBe(BLUE);
});

test('empty day: no tasks, and the check-in note before check-in', async ({ page, api, open }) => {
  api.on('GET', '/staff/mobile/attendance', attendance(shift()));
  api.on('GET', '/staff/mobile/tasks', feed());
  await open({ now: at('04:05') });
  await tab(page, 'Tasks').click();
  await expect(page.getByText('No tasks today').last()).toBeVisible();
  await expect(page.getByText('Check in before starting a task.')).toBeVisible();
  await expect(button(page, 'Check in')).toBeVisible();
});

test.describe('task details', () => {
  test('not started and checked in: step 1 and Start cleaning opens the scanner screen', async ({ page, api, open }) => {
    api.on('GET', '/staff/mobile/attendance', attendance(checkedIn()));
    api.on('GET', '/staff/mobile/tasks', feed(task(501, 'Ground floor washroom')));
    await open({ now: at('04:30') });
    await tab(page, 'Tasks').click();
    await page.getByRole('button', { name: /^Ground floor washroom, / }).click();
    await expect(page.getByText('Task 501')).toBeVisible();
    await expect(page.getByTestId('step-1-current')).toBeVisible();
    await expect(page.getByTestId('step-4-later')).toBeVisible();
    await expect(page.getByText('Refill the soap dispensers.')).toBeVisible();
    await expect(page.getByTestId('what-to-clean')).toContainText('Wash basin');
    await button(page, 'Start cleaning').click();
    // The browser cannot scan: the scanner screen says so instead of opening a camera.
    await expect(page.getByRole('heading', { name: 'Scan the task QR' })).toBeVisible();
    await expect(page.getByText(words('Find the code for Ground floor washroom.'))).toBeVisible();
    await expect(page.getByText('Open the installed Hygene Ops Staff app to scan the task QR.')).toBeVisible();
    await button(page, 'Back').click();
    await expect(page.getByRole('heading', { name: 'Scan the task QR' })).toBeHidden();
    await expect(page.getByText('Task 501').filter({ visible: true })).toBeVisible();
  });

  test('not checked in: the note and a Check in action', async ({ page, api, open }) => {
    api.on('GET', '/staff/mobile/attendance', attendance(shift()));
    api.on('GET', '/staff/mobile/tasks', feed(task(501, 'Ground floor washroom')));
    await open({ now: at('04:05') });
    await tab(page, 'Tasks').click();
    await page.getByRole('button', { name: /^Ground floor washroom, / }).click();
    await expect(page.getByText('Task 501')).toBeVisible();
    await expect(page.getByText('Check in before starting a task.').filter({ visible: true })).toBeVisible();
    await expect(button(page, 'Check in')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start cleaning' })).toHaveCount(0);
  });

  // App bug E2E-1 (fix spec to be numbered by the lead): Task details "Check in" calls
  // navigate(StaffTabs) and React Navigation 7 pushes a second tab navigator instead of going back.
  test('not checked in: Check in returns to the one My day', async ({ page, api, open }) => {
    api.on('GET', '/staff/mobile/attendance', attendance(shift()));
    api.on('GET', '/staff/mobile/tasks', feed(task(501, 'Ground floor washroom')));
    await open({ now: at('04:05') });
    await tab(page, 'Tasks').click();
    await page.getByRole('button', { name: /^Ground floor washroom, / }).click();
    await button(page, 'Check in').click();
    await expect(page.getByTestId('day-header-title')).toHaveCount(1);
    await expect(page.getByTestId('day-header-title')).toHaveText(words('Check in to start your shift'));
    await expect(page.getByText('Task 501')).toHaveCount(0);
  });

  test('in progress: step 2 and Take task photos', async ({ page, api, open }) => {
    api.on('GET', '/staff/mobile/attendance', attendance(checkedIn()));
    api.on('GET', '/staff/mobile/tasks', feed(task(501, 'Ground floor washroom', { status: 'IN_PROGRESS', verificationState: 'CLEANING' })));
    await open({ now: at('05:30') });
    await tab(page, 'Tasks').click();
    await page.getByRole('button', { name: /^Ground floor washroom, / }).click();
    await expect(page.getByTestId('step-1-done')).toBeVisible();
    await expect(page.getByTestId('step-2-current')).toBeVisible();
    await button(page, 'Take task photos').click();
    await expect(page.getByText('Task photos').last()).toBeVisible();
  });

  test('submitted: all steps done and no next action', async ({ page, api, open }) => {
    api.on('GET', '/staff/mobile/attendance', attendance(checkedIn()));
    api.on('GET', '/staff/mobile/tasks', feed(task(501, 'Ground floor washroom', { staffSubmittedAt: submittedAt })));
    await open({ now: at('06:30') });
    await tab(page, 'Tasks').click();
    await page.getByRole('button', { name: /^Ground floor washroom, / }).click();
    await expect(page.getByTestId('step-4-done')).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Start cleaning|Take task photos|Check in)$/ })).toHaveCount(0);
  });
});
