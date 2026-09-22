import type { Locator, Page, TestInfo } from '@playwright/test';
import { join } from 'node:path';
import { fixture } from './support/api';
import { feed } from './support/data';
import { daySentence, expect, tab, test, ur, words, type Language } from './support/test';

const screens = join(__dirname, '../../docs/plan-project/staff-work-days/screens');
const sunday = '2026-11-15T06:00:00.000Z';
const emptyAttendance = { body: fixture('attendance-empty') };
const dayOffProfile = { body: fixture('profile-me-day-off') };
const profile = fixture<{ success: true; data: { usualShift: { start: string; end: string } } }>('profile');
const profileWithWorkDays = {
  body: { ...profile, data: { ...profile.data, usualShift: { ...profile.data.usualShift, days: ['MON', 'WED'] } } },
};
const languages = ['en', 'ur'] as const;

async function capture(page: Page, anchor: Locator, screen: string, language: Language, info: TestInfo) {
  if (info.project.name !== 'phone') return;
  const original = page.viewportSize()!;
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await anchor.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: join(screens, `${screen}-${width}-${language}.png`),
      animations: 'disabled',
    });
  }
  await page.setViewportSize(original);
}

test.afterEach(async ({ page, api }) => {
  await expect(page.getByText(/Request failed with status code/i)).toHaveCount(0);
  expect(api.unexpected).toEqual([]);
});

for (const language of languages) {
  const copy = (english: string) => language === 'ur' ? ur(english) : english;

  test(`My day explains the day off and the next Wednesday shift (${language})`, async ({ page, api, open }, info) => {
    api.on('GET', '/staff/mobile/attendance', emptyAttendance);
    api.on('GET', '/staff/mobile/tasks', feed());
    api.on('GET', '/staff/profile/me', dayOffProfile);
    await open({ now: sunday, language });

    const sentence = daySentence(page);
    await expect(sentence.title).toHaveText(words(copy('Day off today')));
    const nextShift = language === 'ur'
      ? ur('Your next shift is {day} at {time}.', { day: ur('Wednesday'), time: '9:00 AM' })
      : 'Your next shift is Wednesday at 9:00 AM.';
    await expect(sentence.sub).toHaveText(words(nextShift));
    await expect(page.getByTestId('day-header-rail')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /check in|check out|چیک اِن|چیک آؤٹ/i })).toHaveCount(0);
    await capture(page, sentence.title, 'staff-app-my-day', language, info);
  });

  test(`Profile shows the Mon and Wed work days (${language})`, async ({ page, api, open }, info) => {
    const self = fixture<{ success: true; data: Record<string, unknown> }>('profile-me');
    api.on('GET', '/staff/profile/me', { body: { ...self, data: { ...self.data, workDays: ['MON', 'WED'] } } });
    api.on('GET', '/staff/mobile/profile', profileWithWorkDays);
    await open({ now: sunday, language });
    await tab(page, copy('Profile')).click();

    const label = page.getByText(copy('Work days'), { exact: true });
    await expect(label).toBeVisible();
    await expect(page.getByText(language === 'ur' ? 'پیر، بدھ' : 'Mon, Wed', { exact: true })).toBeVisible();
    await capture(page, label, 'staff-app-profile', language, info);
  });
}

test('Profile can read days from the summary alone', async ({ page, api, open }) => {
  api.on('GET', '/staff/mobile/profile', profileWithWorkDays);
  await open({ now: sunday });
  await tab(page, 'Profile').click();
  await expect(page.getByText('Mon, Wed', { exact: true })).toBeVisible();
});

test('an older profile still shows the empty My day state', async ({ page, api, open }) => {
  api.on('GET', '/staff/mobile/attendance', emptyAttendance);
  api.on('GET', '/staff/mobile/tasks', feed());
  await open({ now: sunday });
  await expect(daySentence(page).title).toHaveText(words('No shift loaded for today'));
  await expect(page.getByTestId('day-header-rail')).toHaveCount(0);
});
