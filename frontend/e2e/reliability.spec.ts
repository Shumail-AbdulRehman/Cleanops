import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { enter, expect, fixture, sql, test } from './fixtures';
import { addScheduleButton, copy, ui, uiStarts } from './workspace-helpers';

const { starter, enterprise, dirty, effectiveDate, overlapTitle } = fixture.reliability;
const widths = [1440, 390] as const;
const languages = ['en', 'ur'] as const;
type Language = typeof languages[number];
type ScheduleFixture = typeof starter;
const screens = new URL('../../docs/plan-project/reliability-fixes/screens/', import.meta.url);
const workerRequired = 'Your plan does not assign staff automatically. Choose a worker for this schedule.';
const workerOverlap = '{name} already has an overlapping schedule: {title}. Choose a different time or worker.';
const shiftMismatch = "This time falls outside {name}'s shift ({start}–{end}). Choose a time inside the shift or update the shift.";
const nextLabel = { en: 'Next', ur: 'اگلا' };
const createLabel = { en: 'Create schedule', ur: 'شیڈول بنائیں' };
const automaticLabel = { en: 'Use automatic assignment', ur: 'خودکار تفویض استعمال کریں' };

test.afterEach(async ({ page }) => {
  await expect(page.getByText(/Request failed with status code/i)).toHaveCount(0);
});

async function capture(page: Page, screen: string, width: number, language: Language) {
  const destination = new URL(`${screen}-${width}-${language}.png`, screens);
  // The verification pass runs these tests again and reads the saved captures.
  if (existsSync(destination)) return;
  await mkdir(screens, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ animations: 'disabled' });
  await writeFile(destination, png, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
}

async function openTeam(page: Page, data: ScheduleFixture, title: string, language: Language = 'en') {
  await enter(page, `/locations/${data.locationId}?tab=templates`, data.ownerKey, language);
  await addScheduleButton(page, language).click();
  const wizard = page.getByRole('dialog');
  await wizard.getByLabel(ui('Task title')).fill(title);
  await wizard.getByLabel(ui('Area template')).selectOption({ label: data.areaName });
  await wizard.getByRole('button', { name: nextLabel[language], exact: true }).click();
  return wizard;
}

async function configureSchedule(page: Page, language: Language, start: string, end: string, day?: string) {
  const t = (key: string) => copy(key, language);
  const wizard = page.getByRole('dialog');
  await wizard.getByRole('button', { name: nextLabel[language], exact: true }).click();
  await wizard.getByLabel(t('Effective from'), { exact: true }).fill(effectiveDate);
  await wizard.getByLabel(uiStarts('Start time')).fill(start);
  await wizard.getByLabel(uiStarts('End time')).fill(end);
  if (day) {
    await wizard.getByLabel(t('Recurrence'), { exact: true }).selectOption('CHOSEN');
    const days = wizard.getByRole('group', { name: t('Repeat on'), exact: true });
    for (const weekday of await days.getByRole('button').all()) {
      if (await weekday.getAttribute('aria-label') !== t(day) && await weekday.getAttribute('aria-pressed') === 'true') {
        await weekday.click();
      }
    }
    const chosenDay = days.getByRole('button', { name: t(day), exact: true });
    if (await chosenDay.getAttribute('aria-pressed') !== 'true') await chosenDay.click();
  }
  await wizard.getByRole('button', { name: nextLabel[language], exact: true }).click();
}

async function submit(page: Page, language: Language, status: number, code?: string, field?: string) {
  const [response] = await Promise.all([
    page.waitForResponse(result => new URL(result.url()).pathname === '/api/task-template' && result.request().method() === 'POST'),
    page.getByRole('dialog').getByRole('button', { name: createLabel[language], exact: true }).click(),
  ]);
  expect(response.status()).toBe(status);
  if (code) expect((await response.json()).errors[0]).toMatchObject({ code, field });
}

async function savedSchedule(data: ScheduleFixture, title: string) {
  return sql('SELECT "staffId", array_to_json("repeatDays") AS "repeatDays" FROM "TaskTemplate" WHERE "locationId" = $1 AND title = $2', [data.locationId, title]);
}

// The protected metadata and decision use the real API. Only storage bytes are synthetic.
async function useReviewImage(page: Page) {
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#b8aca0';
    ctx.fillRect(0, 0, 640, 480);
    const porcelain = ctx.createRadialGradient(320, 250, 20, 320, 250, 230);
    porcelain.addColorStop(0, '#a9b2b1');
    porcelain.addColorStop(0.74, '#f2f3ef');
    porcelain.addColorStop(1, '#d1d9d6');
    ctx.fillStyle = porcelain;
    ctx.beginPath();
    ctx.ellipse(320, 250, 228, 168, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#597172';
    ctx.fillRect(300, 65, 40, 99);
    ctx.beginPath();
    ctx.arc(320, 283, 16, 0, Math.PI * 2);
    ctx.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const headers = {
    'access-control-allow-origin': process.env.HYGENE_E2E_WEB_ORIGIN!,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
  await page.route(url => url.pathname === `/api/evidence/${dirty.assetId}/content` && url.searchParams.get('variant') === 'review', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    return route.fulfill({ contentType: 'image/png', body: Buffer.from(encoded, 'base64'), headers });
  });
}

for (const width of widths) {
  for (const language of languages) {
    const t = (key: string) => copy(key, language);
    const variant = `${width}px ${language}`;
    test.describe(variant, () => {
      test.use({ viewport: { width, height: width === 390 ? 844 : 900 } });

      test('manager accepts a retained dirty photo and the requirement stays satisfied after reload', async ({ page }) => {
        await useReviewImage(page);
        await enter(page, `/exceptions/${dirty.reviewId}`, dirty.reviewerKey, language);
        const inspection = page.getByRole('region', { name: t('Review photo'), exact: true });
        await inspection.scrollIntoViewIfNeeded();
        const image = inspection.getByRole('img', { name: /^Wash basin/ });
        await expect(image).toBeVisible();
        await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(640);
        await expect(inspection.getByText(t('AI result: more cleaning needed. You can accept this photo if it is clean.'), { exact: true })).toBeVisible();
        const accept = inspection.getByRole('button', { name: t('Accept this photo'), exact: true });
        await expect(accept).toBeVisible();
        await capture(page, 'dirty-review', width, language);
        await inspection.getByLabel(t('What did you check?')).fill('Checked the basin and drain in the retained photo.');
        const [decision] = await Promise.all([
          page.waitForResponse(response => new URL(response.url()).pathname === `/api/verification-exceptions/${dirty.reviewId}/actions`),
          accept.click(),
        ]);
        expect(decision.ok()).toBe(true);
        expect(decision.request().postDataJSON()).toMatchObject({ action: 'ACCEPT_EVIDENCE', requirementId: dirty.requirementId });
        await page.reload();
        await expect(page.getByText(t('Photo requirement satisfied'), { exact: true }).first()).toBeVisible();
        expect(await sql('SELECT state FROM "TaskEvidenceRequirement" WHERE id = $1', [dirty.requirementId]))
          .toEqual([{ state: 'MANAGER_ACCEPTED' }]);
      });

      test('Starter requires a worker and saves a non-overlapping schedule with one', async ({ page }) => {
        const title = 'Starter fixed-worker cleaning';
        const wizard = await openTeam(page, starter, title, language);
        await expect(wizard.getByText(t(workerRequired), { exact: true })).toBeVisible();
        await expect(wizard.getByRole('option', { name: automaticLabel[language], exact: true })).toHaveCount(0);
        await expect(wizard.getByRole('button', { name: nextLabel[language], exact: true })).toBeDisabled();
        await capture(page, 'starter-team', width, language);
        await wizard.getByLabel(ui('Assign staff')).selectOption(String(starter.workerId));
        await configureSchedule(page, language, '12:00', '13:00');
        await submit(page, language, 201);
        await expect(wizard).toBeHidden();
        expect(await savedSchedule(starter, title)).toEqual([expect.objectContaining({ staffId: starter.workerId })]);
      });

      test('overlapping work is refused with the translated worker error and nothing is saved', async ({ page }) => {
        const title = 'Overlapping basin cleaning';
        const wizard = await openTeam(page, starter, title, language);
        const worker = wizard.getByLabel(ui('Assign staff'));
        await worker.selectOption(String(starter.workerId));
        await configureSchedule(page, language, '10:30', '11:30');
        await submit(page, language, 409, 'WORKER_OVERLAP', 'staffId');
        const message = t(workerOverlap).replace('{name}', starter.workerName).replace('{title}', overlapTitle);
        await expect(worker).toHaveAccessibleDescription(message);
        await expect(wizard.getByText(message, { exact: true })).toBeVisible();
        expect(await savedSchedule(starter, title)).toEqual([]);
        await capture(page, 'worker-overlap', width, language);
      });
    });
  }
}

test('Enterprise still saves a schedule without a fixed worker', async ({ page }) => {
  const title = 'Automatically assigned cleaning';
  const wizard = await openTeam(page, enterprise, title);
  await expect(wizard.getByRole('option', { name: 'Use automatic assignment' })).toHaveCount(1);
  await configureSchedule(page, 'en', '12:00', '13:00');
  await submit(page, 'en', 201);
  await expect(wizard).toBeHidden();
  expect(await savedSchedule(enterprise, title)).toEqual([expect.objectContaining({ staffId: null })]);
});

test('overnight work outside the daytime shift is refused and nothing is saved', async ({ page }) => {
  const title = 'Overnight basin cleaning';
  const language = 'ur';
  const t = (key: string) => copy(key, language);
  const wizard = await openTeam(page, starter, title, language);
  await wizard.getByLabel(ui('Assign staff')).selectOption(String(starter.workerId));
  await configureSchedule(page, language, '16:00', '10:00');
  await submit(page, language, 422, 'SHIFT_MISMATCH', 'shiftStart');
  const message = t(shiftMismatch).replace('{name}', starter.workerName).replace('{start}', '09:00').replace('{end}', '17:00');
  await expect(wizard.getByLabel(uiStarts('Start time'))).toHaveAccessibleDescription(message);
  await expect(wizard.getByText(message, { exact: true })).toBeVisible();
  expect(await savedSchedule(starter, title)).toEqual([]);
});

test('identical hours save for the same worker on a different repeat day', async ({ page }) => {
  const title = 'Tuesday basin cleaning';
  const wizard = await openTeam(page, starter, title);
  await wizard.getByLabel('Assign staff', { exact: true }).selectOption(String(starter.workerId));
  await configureSchedule(page, 'en', '10:00', '11:00', 'Tuesday');
  await submit(page, 'en', 201);
  await expect(wizard).toBeHidden();
  expect(await savedSchedule(starter, title)).toEqual([{ staffId: starter.workerId, repeatDays: ['TUE'] }]);
});
