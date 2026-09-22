import { at, button, daySentence, expect, test, ur, words } from './support/test';
import { attendance, checkedIn, feed, shift, submittedAt, task } from './support/data';
import { ok } from './support/api';

// My day: the one sentence and the one dock action for each moment of the day (specs 15, 29, 30, 31, 46).

const washroom = () => task(501, 'Ground floor washroom', { shiftStart: '2026-11-12T05:00:00.000Z', shiftEnd: '2026-11-12T06:00:00.000Z' });
const lobby = () => task(502, 'Reception lobby', { shiftStart: '2026-11-12T07:00:00.000Z', shiftEnd: '2026-11-12T08:00:00.000Z' });

test.describe('before check-in', () => {
  test('before the window opens: when it opens, and no button yet', async ({ page, api, open }) => {
    api.on('GET', '/staff/mobile/attendance', attendance(shift()));
    await open({ now: at('03:00') });
    const { title, sub } = daySentence(page);
    await expect(title).toHaveText(words('Check-in opens at 8:30 AM'));
    await expect(sub).toContainText(words('Your shift starts at 9:00 AM at', false));
    await expect(sub).toContainText(words('Head Office', false));
    await expect(page.getByRole('button', { name: /^Check in/ })).toHaveCount(0);
  });

  test('window open: check in sentence and the Check in dock', async ({ page, api, open }) => {
    api.on('GET', '/staff/mobile/attendance', attendance(shift()));
    await open({ now: at('04:05') });
    await expect(daySentence(page).title).toHaveText(words('Check in to start your shift'));
    await expect(button(page, 'Check in')).toBeVisible();
  });

  test('late: the late sentence and Check in late', async ({ page, api, open }) => {
    api.on('GET', '/staff/mobile/attendance', attendance(shift()));
    await open({ now: at('04:30') });
    const { title, sub } = daySentence(page);
    await expect(title).toHaveText(words('You are late. Check in now.'));
    await expect(sub).toHaveText(words('Shift started at 9:00 AM. This check-in will be marked late.'));
    await expect(button(page, 'Check in late')).toBeVisible();
  });

  test('closed: shift time closed and no attendance button', async ({ page, api, open }) => {
    api.on('GET', '/staff/mobile/attendance', attendance(shift()));
    await open({ now: at('12:30') });
    await expect(daySentence(page).title).toHaveText(words('Shift time closed'));
    await expect(daySentence(page).sub).toHaveText(words('This shift ended at 5:00 PM without a check-in. If this is wrong, tell your manager.'));
    await expect(page.getByRole('button', { name: /^Check in/ })).toHaveCount(0);
  });
});

test.describe('on shift', () => {
  test.beforeEach(({ api }) => {
    api.on('GET', '/staff/mobile/attendance', attendance(checkedIn()));
  });

  test('next task: the sentence names the task and the dock starts cleaning', async ({ page, api, open }) => {
    api.on('GET', '/staff/mobile/tasks', feed(washroom(), lobby()));
    await open({ now: at('04:30') });
    const { title, sub } = daySentence(page);
    await expect(title).toContainText(words('Next:', false));
    await expect(title).toContainText(words('Ground floor washroom', false));
    await expect(sub).toHaveText(words('Ground floor washroom clean. Finish by 11:00 AM.'));
    await expect(page.getByTestId('day-header-rail')).toContainText(words('Checked in 8:58 AM', false));
    await button(page, 'Start cleaning').click();
    await expect(page.getByText('Ground floor washroom').last()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back' }).last()).toBeVisible();
  });

  test('cleaning: the task in progress asks for photos', async ({ page, api, open }) => {
    api.on('GET', '/staff/mobile/tasks', feed(washroom(), task(502, 'Reception lobby', { status: 'IN_PROGRESS', verificationState: 'CAPTURING', startedAt: '2026-11-12T05:10:00.000Z' })));
    await open({ now: at('05:30') });
    await expect(daySentence(page).title).toContainText(words('Cleaning:', false));
    await expect(daySentence(page).title).toContainText(words('Reception lobby', false));
    await expect(daySentence(page).sub).toHaveText(words('When it is clean, take the task photos.'));
    await expect(button(page, 'Take task photos')).toBeVisible();
  });

  test('retake: a photo to take again comes first', async ({ page, api, open }) => {
    api.on('GET', '/staff/mobile/tasks', feed(washroom(), task(502, 'Reception lobby', { status: 'IN_PROGRESS', verificationState: 'REWORK_REQUIRED' })));
    await open({ now: at('05:30') });
    await expect(daySentence(page).title).toContainText(words('Retake a photo:', false));
    await expect(daySentence(page).title).toContainText(words('Reception lobby', false));
    await expect(button(page, 'Retake photo')).toBeVisible();
  });

  test('overdue: the late task and its finish time', async ({ page, api, open }) => {
    api.on('GET', '/staff/mobile/tasks', feed(task(501, 'Ground floor washroom', { status: 'NOT_COMPLETED_INTIME' }), lobby()));
    await open({ now: at('06:30') });
    await expect(daySentence(page).title).toContainText(words('Overdue:', false));
    await expect(daySentence(page).title).toContainText(words('Ground floor washroom', false));
    await expect(daySentence(page).sub).toHaveText(words('This should have finished by 11:00 AM. Finish it now.'));
    await expect(button(page, 'Take task photos')).toBeVisible();
  });

  test('Urdu puts the task name on its own line', async ({ page, api, open }) => {
    api.on('GET', '/staff/mobile/tasks', feed(washroom()));
    await open({ now: at('04:30'), language: 'ur' });
    const { title } = daySentence(page);
    // The label line and the name line are separate text nodes; the Urdu label does not contain the name.
    const label = title.getByText(ur('Next: {area}').replace('{area}', '').trim(), { exact: true });
    await expect(label).toBeVisible();
    await expect(label).not.toContainText(words('Ground floor washroom', false));
    const name = title.getByText('Ground floor washroom');
    await expect(name).toBeVisible();
    const [labelBox, nameBox] = [await label.boundingBox(), await name.boundingBox()];
    expect(nameBox!.y).toBeGreaterThan(labelBox!.y + labelBox!.height / 2);
    await expect(button(page, ur('Start cleaning'))).toBeVisible();
  });
});

test.describe('end of the day', () => {
  test('all submitted: the wait status says when check-out opens', async ({ page, api, open }) => {
    api.on('GET', '/staff/mobile/attendance', attendance(checkedIn()));
    api.on('GET', '/staff/mobile/tasks', feed(task(501, 'Ground floor washroom', { staffSubmittedAt: submittedAt })));
    await open({ now: at('07:00') });
    await expect(daySentence(page).title).toHaveText(words('All work submitted'));
    await expect(daySentence(page).sub).toHaveText(words('Manager review may still be needed.'));
    await expect(page.getByText(words('Check-out opens at 5:00 PM'))).toBeVisible();
    await expect(page.getByRole('button', { name: /^Check out/ })).toHaveCount(0);
  });

  test('time to check out: Check out shows the receipt the server recorded', async ({ page, api, open }) => {
    let reads = 0;
    api.on('GET', '/staff/mobile/attendance', () => {
      reads += 1;
      // The second read happens when Check out is pressed: the server already has the check-out.
      return reads === 1 ? attendance(checkedIn()) : attendance(checkedIn({ status: 'CHECKED_OUT', checkOutTime: '2026-11-12T12:05:00.000Z' }));
    });
    api.on('GET', '/staff/mobile/tasks', feed(task(501, 'Ground floor washroom', { staffSubmittedAt: submittedAt })));
    await open({ now: at('12:05') });
    await expect(daySentence(page).title).toHaveText(words('Time to check out'));
    await button(page, 'Check out').click();
    await expect(page.getByRole('heading', { name: 'Checked out' })).toBeVisible();
    await expect(page.getByText('Time worked')).toBeVisible();
    await expect(page.getByText('1 of 1')).toBeVisible();
    await button(page, 'Back to my day').click();
    await expect(daySentence(page).title).toHaveText(words('Shift finished'));
  });

  test('finished: in and out times, no action', async ({ page, api, open }) => {
    api.on('GET', '/staff/mobile/attendance', attendance(checkedIn({ status: 'CHECKED_OUT', checkOutTime: '2026-11-12T12:05:00.000Z' })));
    api.on('GET', '/staff/mobile/tasks', feed(task(501, 'Ground floor washroom', { staffSubmittedAt: submittedAt })));
    await open({ now: at('12:30') });
    await expect(daySentence(page).title).toHaveText(words('Shift finished'));
    await expect(daySentence(page).sub).toHaveText(words('In 8:58 AM. Out 5:05 PM. Thank you.'));
    await expect(page.getByRole('button', { name: /^Check (in|out)/ })).toHaveCount(0);
  });

  test('missed check-out: overdue sentence and Complete check-out', async ({ page, api, open }) => {
    api.on('GET', '/staff/mobile/attendance', attendance(checkedIn({ status: 'MISSED_CHECKOUT' })));
    api.on('GET', '/staff/mobile/tasks', feed(task(501, 'Ground floor washroom', { staffSubmittedAt: submittedAt })));
    await open({ now: at('14:00') });
    await expect(daySentence(page).title).toHaveText(words('Check-out is overdue'));
    await expect(daySentence(page).sub).toHaveText(words('Your shift ended at 5:00 PM. This late check-out stays on your record.'));
    await expect(button(page, 'Complete check-out')).toBeVisible();
  });
});

test.describe('check-out with open work', () => {
  test.beforeEach(({ api }) => {
    api.on('GET', '/staff/mobile/tasks', feed(task(501, 'Ground floor washroom', { staffSubmittedAt: submittedAt }), lobby()));
  });

  test('"Go back to my work" closes the warning', async ({ page, api, open }) => {
    api.on('GET', '/staff/mobile/attendance', attendance(checkedIn()));
    await open({ now: at('12:05') });
    await expect(button(page, 'Start cleaning')).toBeVisible();
    await button(page, 'Check out').click();
    await expect(page.getByText('1 task is not submitted')).toBeVisible();
    await button(page, 'Go back to my work').click();
    await expect(page.getByText('1 task is not submitted')).toBeHidden();
    await expect(button(page, 'Start cleaning')).toBeVisible();
    expect(api.callsTo('/staff/mobile/attendance')).toHaveLength(1);
  });

  test('"Check out anyway" continues to check-out', async ({ page, api, open }) => {
    let reads = 0;
    api.on('GET', '/staff/mobile/attendance', () => {
      reads += 1;
      return reads === 1 ? attendance(checkedIn()) : attendance(checkedIn({ status: 'CHECKED_OUT', checkOutTime: '2026-11-12T12:06:00.000Z' }));
    });
    await open({ now: at('12:05') });
    await button(page, 'Check out').click();
    await button(page, 'Check out anyway').click();
    await expect(page.getByText('1 task is not submitted')).toBeHidden();
    // Check-out starts by asking the server; it already recorded this one, so the receipt shows.
    await expect(page.getByRole('heading', { name: 'Checked out' })).toBeVisible();
    await expect(page.getByText('1 of 2')).toBeVisible();
  });
});

test('no shift loaded: quiet sentence, no dock', async ({ page, api, open }) => {
  api.on('GET', '/staff/mobile/attendance', ok([]));
  api.on('GET', '/staff/mobile/tasks', feed());
  await open({ now: at('06:00') });
  await expect(daySentence(page).title).toHaveText(words('No shift loaded for today'));
  await expect(page.getByRole('button', { name: /^Check (in|out)/ })).toHaveCount(0);
});
