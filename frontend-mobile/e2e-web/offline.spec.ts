import { at, button, expect, setNetwork, tab, test, words } from './support/test';
import { attendance, checkedIn, feed, shift, task } from './support/data';

// Offline banner and dock status (specs 24, 32, 46): no button that cannot work while offline.

test('My day offline: banner, dock status instead of Check in, and back online', async ({ page, api, open }) => {
  api.on('GET', '/staff/mobile/attendance', attendance(shift()));
  await open({ now: at('04:05') });
  await expect(button(page, 'Check in')).toBeVisible();
  await setNetwork(page, false);
  await expect(page.getByRole('alert').filter({ hasText: 'Internet needed to continue' }).first()).toBeVisible();
  await expect(page.getByText('You are seeing the last saved information.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Check in/ })).toHaveCount(0);
  // The last saved sentence stays readable.
  await expect(page.getByTestId('day-header-title')).toHaveText(words('Check in to start your shift'));
  await setNetwork(page, true);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(button(page, 'Check in')).toBeVisible();
});

test('Tasks offline: banner over the saved list', async ({ page, api, open }) => {
  api.on('GET', '/staff/mobile/attendance', attendance(checkedIn()));
  api.on('GET', '/staff/mobile/tasks', feed(task(501, 'Ground floor washroom')));
  await open({ now: at('04:30') });
  await tab(page, 'Tasks').click();
  await expect(page.getByRole('button', { name: /^Ground floor washroom, / })).toBeVisible();
  await setNetwork(page, false);
  await expect(page.getByRole('alert').filter({ hasText: 'Internet needed to continue' }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Ground floor washroom, / })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load more tasks' })).toHaveCount(0);
});

test('photo list offline: the dock says why instead of offering an action', async ({ page, api, open }) => {
  api.on('GET', '/staff/mobile/attendance', attendance(checkedIn()));
  api.on('GET', '/staff/mobile/tasks', feed(task(501, 'Ground floor washroom', { status: 'IN_PROGRESS', verificationState: 'CAPTURING' })));
  await open({ now: at('05:30') });
  await button(page, 'Take task photos').click();
  await expect(button(page, 'Retake photo')).toBeVisible();
  await setNetwork(page, false);
  await expect(page.getByText('Internet needed to continue').filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Retake photo|Submit work|Next photo|Refresh results)$/ })).toHaveCount(0);
});
