import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { enter, expect, fixture, test } from './fixtures';
import { choose, cleaningSchedules, copy, noOverflow, scheduleButton, scheduleDetails } from './workspace-helpers';

const { locationId, week, records } = fixture.cleaningSchedules;
const path = `/locations/${locationId}?tab=templates&week=${week}`;
const owner = 'ownercleaningSchedules';
const screens = new URL('../../docs/plan-project/cleaning-schedules/screens/', import.meta.url);
const morningReset = 'Morning washroom reset';
const restock = 'Washroom restock';
const worker = 'Bilal Ahmed';
const workerTitles = records.filter(record => record.worker === worker).map(record => record.title);
type Language = 'en' | 'ur';

test.use({
  timezoneId: 'Asia/Karachi',
  viewport: { width: 1440, height: 900 },
  trace: 'off',
  screenshot: 'off',
  video: 'off',
});

test.beforeEach(async ({ context }) => {
  await context.route(/^https?:\/\//, route =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

test.afterEach(async ({ page }) => {
  await expect(page.getByText(/Request failed with status code/i)).toHaveCount(0);
});

const groupNames = ['Morning', 'Afternoon', 'Evening', 'Night'];
const allTitles = records.map(record => record.title);

function listButtons(page: Page, language: Language = 'en') {
  return cleaningSchedules(page, language).getByRole('listitem').getByRole('button');
}

async function expectList(page: Page, titles: string[]) {
  const buttons = listButtons(page);
  await expect(buttons).toHaveCount(titles.length);
  for (const title of titles) {
    await expect(buttons.filter({ has: page.getByText(title, { exact: true }) })).toHaveCount(1);
  }
}

function viewButton(page: Page, view: 'List' | 'Week', language: Language = 'en') {
  return cleaningSchedules(page, language).getByRole('group', { name: copy('View', language), exact: true })
    .getByRole('button', { name: copy(view, language), exact: true });
}

function coverageDay(page: Page, day: string, language: Language = 'en') {
  return cleaningSchedules(page, language).getByRole('button', { name: new RegExp(`^${copy(day, language)} `) });
}

async function capture(page: Page, screen: string, width: number, language: Language) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: fileURLToPath(new URL(`${screen}-${width}-${language}.png`, screens)),
    animations: 'disabled',
    fullPage: screen !== 'panel',
  });
}

test('the grouped list shows all 22 schedules once with no duplicate table', async ({ page }) => {
  await enter(page, path, owner);
  const tab = cleaningSchedules(page);
  await expect(viewButton(page, 'List')).toHaveAttribute('aria-pressed', 'true');
  await expect(tab.getByRole('heading', { level: 3 })).toHaveText(groupNames);
  for (const group of groupNames) {
    await expect(tab.getByRole('region', { name: group, exact: true }).getByRole('list')).toBeVisible();
  }
  await expectList(page, allTitles);
  await expect(tab.getByRole('table')).toHaveCount(0);
});

test('staff and search filters combine and clearing restores every schedule', async ({ page }) => {
  await enter(page, path, owner);
  const tab = cleaningSchedules(page);
  const search = tab.getByRole('searchbox', { name: 'Search schedules, areas or staff' });
  await choose(page, 'Staff', worker, 'en', tab);
  await expectList(page, workerTitles);
  await search.fill('LOBBY FLOOR');
  await expectList(page, ['Lobby floor sweep']);
  await tab.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expectList(page, workerTitles);
  await choose(page, 'Staff', 'All staff', 'en', tab);
  await expectList(page, allTitles);
});

test('choosing a coverage day filters the list and removing the chip clears it', async ({ page }) => {
  await enter(page, path, owner);
  const monday = coverageDay(page, 'Monday');
  await monday.click();
  await expect(monday).toHaveAttribute('aria-pressed', 'true');
  await expectList(page, records.filter(record => record.repeatDays.includes('MON')).map(record => record.title));
  const chip = cleaningSchedules(page).getByRole('button', { name: 'Runs on Mon', exact: true });
  await chip.click();
  await expect(chip).toHaveCount(0);
  await expect(monday).toHaveAttribute('aria-pressed', 'false');
  await expectList(page, allTitles);
});

test('Week reloads on the selected URL with staff rows, jobs and days off', async ({ page }) => {
  await enter(page, path, owner);
  await viewButton(page, 'Week').click();
  await expect(page).toHaveURL(/[?&]view=week(?:&|$)/);
  await page.reload();
  await expect(viewButton(page, 'Week')).toHaveAttribute('aria-pressed', 'true');
  const table = cleaningSchedules(page).getByRole('table', { name: 'Week', exact: true });
  await expect(table.getByRole('rowheader')).toHaveCount(7);
  const row = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /^Ayesha Noor/ }) });
  const cells = row.getByRole('cell');
  await expect(cells).toHaveCount(7);
  await expect(scheduleButton(cells.nth(0), morningReset)).toBeVisible();
  await expect(cells.nth(5)).toHaveText('Day off');
  await expect(cells.nth(6)).toHaveText('Day off');
});

test('editing a schedule from details saves the title across reload', async ({ page }) => {
  await enter(page, path, owner);
  await scheduleButton(cleaningSchedules(page), morningReset).click();
  const details = scheduleDetails(page, morningReset);
  await expect(details).toContainText('North washroom');
  await details.getByRole('button', { name: 'Edit schedule', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit cleaning schedule', exact: true });
  const title = editor.getByRole('textbox', { name: 'Schedule title', exact: true });
  await expect(title).toHaveValue(morningReset);
  const updated = 'Morning washroom refresh';
  await title.fill(updated);
  const id = records.find(record => record.title === morningReset)!.id;
  const saved = page.waitForResponse(response =>
    response.request().method() === 'PATCH' && new URL(response.url()).pathname === `/api/task-template/${id}`);
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(editor).toHaveCount(0);
  await page.reload();
  await expect(scheduleButton(cleaningSchedules(page), updated)).toBeVisible();
  await expect(scheduleButton(cleaningSchedules(page), morningReset)).toHaveCount(0);
});

test('deleting from details confirms the removal and stays gone after reload', async ({ page }) => {
  await enter(page, path, owner);
  const title = 'Lobby seating wipe';
  const tab = cleaningSchedules(page);
  await scheduleButton(tab, title).click();
  await scheduleDetails(page, title)
    .getByRole('button', { name: `Delete ${title}`, exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: `Delete ${title}?`, exact: true });
  await confirmation.getByRole('button', { name: 'Delete schedule', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(scheduleButton(tab, title)).toHaveCount(0);
  await page.reload();
  await expectList(page, allTitles.filter(candidate => candidate !== title));
});

test('at 390px the cards, Filters sheet and selected-day agenda are usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await enter(page, path, owner);
  const tab = cleaningSchedules(page);
  await expectList(page, allTitles);
  const card = scheduleButton(tab, morningReset);
  await expect(card).toBeVisible();
  await expect(card).toContainText('Ayesha Noor');
  await noOverflow(page);
  await tab.getByRole('button', { name: 'Filters', exact: true }).click();
  const filters = page.getByRole('dialog', { name: 'Filters', exact: true });
  await choose(page, 'Staff', worker, 'en', filters);
  await filters.getByRole('button', { name: 'Close', exact: true }).click();
  await expectList(page, workerTitles);

  await viewButton(page, 'Week').click();
  await coverageDay(page, 'Monday').click();
  await expect(tab.getByRole('table', { name: 'Week', exact: true })).toHaveCount(0);
  const agenda = tab.getByRole('region', { name: /^Mon / });
  await expect(agenda.getByRole('listitem')).toHaveCount(workerTitles.length);
  const job = scheduleButton(agenda, 'Lobby floor sweep');
  await expect(job).toContainText('06:15');
  await expect(job).toContainText('Bilal');
  await coverageDay(page, 'Sunday').click();
  await expect(tab.getByRole('region', { name: /^Sun / })).toContainText('0 jobs');
  await expect(tab.getByRole('region', { name: /^Sun / }).getByRole('listitem')).toHaveCount(0);
  await noOverflow(page);
});

for (const width of [1440, 390]) {
  for (const language of ['en', 'ur'] as const) {
    test(`captures List, Week and details at ${width}px (${language})`, async ({ page }) => {
      await mkdir(screens, { recursive: true });
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await enter(page, path, owner, language);
      const tab = cleaningSchedules(page, language);
      await expect(tab).toBeVisible();
      await expect(listButtons(page, language)).toHaveCount(allTitles.length);
      await expect(page.locator('html')).toHaveAttribute('dir', language === 'ur' ? 'rtl' : 'ltr');
      await noOverflow(page);
      await capture(page, 'list', width, language);

      await viewButton(page, 'Week', language).click();
      if (width === 1440) {
        await expect(tab.getByRole('table', { name: copy('Week', language), exact: true })).toBeVisible();
      } else {
        await coverageDay(page, 'Monday', language).click();
        await expect(scheduleButton(tab, morningReset)).toBeVisible();
      }
      await noOverflow(page);
      await capture(page, 'week', width, language);

      const restockId = records.find(record => record.title === restock)!.id;
      await page.goto(`${path}#schedule-${restockId}`);
      const panel = scheduleDetails(page, restock);
      await expect(panel).toBeVisible();
      await expect(panel.getByRole('listitem')).toHaveCount(3);
      await capture(page, 'panel', width, language);
    });
  }
}
