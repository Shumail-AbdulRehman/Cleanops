import type { Page } from '@playwright/test';
import { fixture, ok } from './support/api';
import { feed, task } from './support/data';
import { at, button, expect, tab, test } from './support/test';

const manifestPath = '/task-instance/501/verification';

async function openRetake(page: Page) {
  await tab(page, 'Tasks').click();
  await page.getByRole('button', { name: /Ground floor washroom/ }).click();
  await button(page, 'Take task photos').click();
  await expect(button(page, 'Retake photo')).toBeVisible();
}

test.afterEach(async ({ page }) => {
  await expect(page.getByText(/Request failed with status code/i)).toHaveCount(0);
});

test('web shows the retake action and hands camera capture off to the installed staff app', async ({ page, api, open }) => {
  const work = task(501, 'Ground floor washroom', {
    title: 'Morning clean', status: 'IN_PROGRESS', verificationState: 'CAPTURING',
    startedAt: at('05:00'), shiftEnd: at('07:00'),
  });
  api.on('GET', '/staff/mobile/tasks', feed(work))
    .on('GET', '/task-instance/501', ok(work))
    .on('GET', manifestPath, { body: fixture('retake') });
  await open({ now: at('05:30') });
  await openRetake(page);
  await button(page, 'Retake photo').click();
  await expect(page.getByText('Open the installed staff app to scan the task QR and take photos.', { exact: true })).toBeVisible();
  expect(api.callsTo(manifestPath, 'GET').length).toBeGreaterThan(0);
  expect(api.callsTo(/capture-session/, 'POST')).toEqual([]);
  expect(api.unexpected).toEqual([]);
});
