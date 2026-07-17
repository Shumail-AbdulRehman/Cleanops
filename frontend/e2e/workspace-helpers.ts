import type { Locator, Page } from '@playwright/test';
import { expect } from './fixtures';
import { translate } from '../src/i18n/translations';

export const copy = (key: string, language = 'en') => translate(key, language === 'ur' ? 'ur' : 'en');
export const named = (key: string, language = 'en') => new RegExp('^' + copy(key, language).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':');
// Location screens retain a small page-local dictionary ahead of global t().
const localUrdu: Record<string, string> = {
  'Location register': 'مقامات کا رجسٹر', 'Week at a glance': 'ہفتے کا جائزہ', 'Tasks submitted': 'جمع شدہ کام',
  'Area template': 'علاقے کا سانچہ', 'Task title': 'کام کا عنوان', 'Assign staff': 'کارکن مقرر کریں',
  'Start time': 'شروع ہونے کا وقت', 'End time': 'ختم ہونے کا وقت', 'Schedule title': 'شیڈول کا عنوان',
};
export const ui = (key: string) => new RegExp('^(?:' + [copy(key), copy(key, 'ur'), ...(localUrdu[key] ? [localUrdu[key]] : [])].map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')$');
export const uiStarts = (key: string) => new RegExp(ui(key).source.slice(0, -1));

export async function choose(page: Page, label: string, option: string, language = 'en', within?: Locator) {
  await (within ?? page).getByRole('button', { name: named(label, language) }).click();
  await page.getByRole('menuitemradio', { name: option, exact: true }).click();
}

export async function calendar(page: Page, label: string, day: string, language = 'en') {
  await page.getByRole('button', { name: named(label, language) }).click();
  const desired = new Date(day + 'T12:00:00Z');
  const locale = language === 'ur' ? 'ur-PK' : 'en-PK';
  const month = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(desired);
  const grid = page.getByRole('grid');
  // Navigate through the actual keyboard calendar, including distant dates.
  let selected = grid.getByRole('button').filter({ visible: true }).first();
  const startLabel = await grid.getAttribute('aria-labelledby');
  expect(startLabel).toBeTruthy();
  for (let attempt = 0; await grid.getAttribute('aria-label') !== month && attempt < 120; attempt++) {
    const heading = await grid.getAttribute('aria-labelledby');
    const visibleMonth = await page.locator(`[id="${heading}"]`).innerText();
    if (visibleMonth === month) break;
    // data-day is the calendar's existing date value, never a new test hook.
    const current = await selected.getAttribute('data-day');
    const difference = (+day.slice(0, 4) - Number(current!.slice(0, 4))) * 12 + Number(day.slice(5, 7)) - Number(current!.slice(5, 7));
    await selected.press(Math.abs(difference) >= 12 ? (difference > 0 ? 'Shift+PageDown' : 'Shift+PageUp') : (difference > 0 ? 'PageDown' : 'PageUp'));
    selected = grid.getByRole('button').filter({ visible: true }).first();
  }
  await grid.getByRole('button', { name: new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(desired), exact: true }).click();
}

export async function noOverflow(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
}

export const attendanceRegister = (page: Page, language = 'en') => page.getByRole('region', { name: copy('Attendance records', language), exact: true });
export const taskPanel = (page: Page, language = 'en') => page.getByRole('region', { name: copy('Task details', language), exact: true });

export const cleaningSchedules = (page: Page, language = 'en') =>
  page.getByRole('region', { name: copy('Cleaning schedules', language), exact: true });

export function scheduleButton(scope: Page | Locator, title: string) {
  const page = 'page' in scope ? scope.page() : scope;
  return scope.getByRole('button').filter({ has: page.getByText(title, { exact: true }) });
}

export const scheduleDetails = (page: Page, title: string) =>
  page.getByRole('dialog', { name: `\u2068${title}\u2069`, exact: true });

export const addScheduleButton = (page: Page, language = 'en') =>
  cleaningSchedules(page, language).getByRole('button', { name: ui('Add cleaning schedule') })
    .or(cleaningSchedules(page, language).getByRole('button', { name: ui('Add the first schedule') }));
