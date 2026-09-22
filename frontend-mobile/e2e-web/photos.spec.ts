import { at, button, expect, test, words } from './support/test';
import { attendance, checkedIn, feed, task } from './support/data';
import { fixture, ok, type Body } from './support/api';

// Photo list states, the submit dock (specs 08, 35, 45) and the Work submitted receipt (spec 36).
// "Saved, uploading" is a state of this phone's own upload queue: it needs a camera capture, so the
// device flows and the unit tests cover it; the browser covers every state the server reports.

type Manifest = { items: { state: string; requirements: { state: string; currentAttempt: { state: string } | null }[] }[]; staffSubmittedAt: string | null; task: Record<string, unknown> };

/** `GET /task-instance/501/verification` with each item's one photo in the given state. */
function manifest(states: string[], submittedAt: string | null = null): Body {
  const body = fixture('verification') as Body & { data: Manifest };
  body.data.items = body.data.items.slice(0, states.length).map((item, index) => ({
    ...item,
    state: states[index],
    requirements: item.requirements.map(r => ({ ...r, state: states[index], currentAttempt: states[index] === 'MISSING' ? null : { ...r.currentAttempt!, state: states[index] } })),
  }));
  if (submittedAt) {
    body.data.staffSubmittedAt = submittedAt;
    body.data.task = { ...body.data.task, status: 'COMPLETED', staffSubmittedAt: submittedAt, verificationState: 'COMPLETED' };
  }
  return body;
}

test.beforeEach(async ({ api }) => {
  api.on('GET', '/staff/mobile/attendance', attendance(checkedIn()));
  api.on('GET', '/staff/mobile/tasks', feed(
    task(501, 'Ground floor washroom', { status: 'IN_PROGRESS', verificationState: 'CAPTURING' }),
    task(502, 'Reception lobby', { shiftStart: '2026-11-12T07:00:00.000Z', shiftEnd: '2026-11-12T08:00:00.000Z' }),
  ));
});

async function openPhotos(page: import('@playwright/test').Page) {
  await button(page, 'Take task photos').click();
  await expect(page.getByText('Task photos').filter({ visible: true }).first()).toBeVisible();
}

test('each photo shows its own state; a retake comes before Submit', async ({ page, api, open }) => {
  api.on('GET', /^\/task-instance\/501\/verification$/, { body: manifest(['PASSED', 'PROCESSING', 'RECAPTURE_REQUIRED']) });
  await open({ now: at('05:30') });
  await openPhotos(page);
  await expect(page.getByRole('button', { name: 'Wash basin, Uploaded', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mirror, Uploaded, checking', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Floor, Retake photo', exact: true })).toBeVisible();
  await expect(page.getByText(words('1 of 3 photos done'))).toBeVisible();
  await expect(button(page, 'Retake photo')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit work' })).toHaveCount(0);
});

test('only checking left: the dock waits, still no Submit', async ({ page, api, open }) => {
  api.on('GET', /^\/task-instance\/501\/verification$/, { body: manifest(['PASSED', 'PROCESSING']) });
  await open({ now: at('05:30') });
  await openPhotos(page);
  await expect(page.getByText('Waiting for the upload to finish')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit work' })).toHaveCount(0);
});

test('all uploaded: Submit work, then the receipt keeps Submitted and Verified apart', async ({ page, api, open }) => {
  let submitted = false;
  api.on('GET', /^\/task-instance\/501\/verification$/, () => ({ body: manifest(['PASSED', 'PASSED', 'PASSED'], submitted ? '2026-11-12T05:41:00.000Z' : null) }));
  api.on('POST', '/task-instance/501/complete', () => {
    submitted = true;
    return ok({ id: 501, status: 'COMPLETED', staffSubmittedAt: '2026-11-12T05:41:00.000Z' });
  });
  await open({ now: at('05:30') });
  await openPhotos(page);
  await expect(page.getByText(words('3 of 3 photos done'))).toBeVisible();
  await expect(page.getByText('Your work is ready to submit. Manager review may still be needed.')).toBeVisible();
  await button(page, 'Submit work').click();
  await expect(page.getByRole('heading', { name: 'Work submitted' })).toBeVisible();
  expect(api.callsTo('/task-instance/501/complete', 'POST')).toHaveLength(1);
  await expect(page.getByText(words('Submitted at 10:41 AM. Your manager may still review it.'))).toBeVisible();
  await expect(page.getByText(words('3 / 3'))).toBeVisible();
  await expect(page.getByText('Submitted', { exact: true })).toBeVisible();
  await expect(page.getByText('Yes', { exact: true })).toBeVisible();
  await expect(page.getByText('Verified', { exact: true })).toBeVisible();
  await expect(page.getByText('Not yet', { exact: true })).toBeVisible();
  // Another task is still to do, so the receipt offers it.
  await expect(button(page, 'Next task')).toBeVisible();
});

// App bug E2E-1 (fix spec to be numbered by the lead): the receipt's "Next task" calls
// navigate(StaffTabs) and React Navigation 7 pushes a second tab navigator instead of going back.
test('receipt: Next task returns to the one My day', async ({ page, api, open }) => {
  api.on('GET', /^\/task-instance\/501\/verification$/, { body: manifest(['PASSED'], '2026-11-12T05:41:00.000Z') });
  await open({ now: at('05:30') });
  await button(page, 'Take task photos').click();
  await expect(page.getByRole('heading', { name: 'Work submitted' })).toBeVisible();
  await button(page, 'Next task').click();
  await expect(page.getByRole('heading', { name: 'Work submitted' })).toBeHidden();
  await expect(page.getByTestId('day-header-title')).toHaveCount(1);
});
