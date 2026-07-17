import { ui, copy, choose } from './workspace-helpers';
import { test, expect, fixture, enter, backend, sql } from './fixtures';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, 'frontend/e2e/.artifacts/evidence/v5-workforce-evidence');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
async function capture(page: Page, name: string) {
  const width = /-(1366|390)-/.exec(name)?.[1];
  if (width && page.viewportSize()?.width !== Number(width)) await page.setViewportSize({ width: Number(width), height: 900 });
  await mkdir(out, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  const dialog = page.getByRole('dialog').filter({ visible: true });
  if (await dialog.count()) await expect(dialog.first()).toHaveCSS('opacity', '1');
  await page.screenshot({ path: join(out, name + '.png'), animations: 'disabled' });
  if (name.startsWith('app-') && !await dialog.count() && await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 1)) {
    await page.screenshot({ path: join(out, name + '-full.png'), fullPage: true, animations: 'disabled' });
  }
}
const exactPerson = (page: Page, name: string) => page.getByText(name, { exact: true }).filter({ visible: true }).first();
const access = async (page: Page, lang: string) => {
  await page.getByRole('button', { name: lang === 'ur' ? 'عملے کی رسائی' : 'Staff access', exact: true }).first().click();
  return page.getByRole('dialog');
};

test('V5 Team detail and manager workspaces render actual scoped data across desktop phone English Urdu', async ({ browser }) => {
  test.setTimeout(180000);
  const observations: unknown[] = [];
  for (const width of [1366, 390]) for (const lang of ['en', 'ur']) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(); const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await enter(page, '/staff', 'ownerA', lang);
    await expect(exactPerson(page, 'E2E staff transfer')).toBeVisible();
    await capture(page, `app-team-${width}-${lang}`);
    await page.getByRole('table').evaluate(element => element.scrollIntoView({ block: 'start' }));
    await capture(page, `app-team-directory-${width}-${lang}`);
    await page.goto(`/staff/${fixture.staff.transfer.id}`);
    await expect(page.getByRole('heading', { name: 'E2E staff transfer', exact: true })).toBeVisible();
    await capture(page, `app-detail-${width}-${lang}`);
    await page.getByRole('tablist', { name: ui('Team member sections') }).evaluate(element => element.scrollIntoView({ block: 'start' }));
    await capture(page, `app-detail-overview-${width}-${lang}`);
    for (const [tab, translated] of [['Attendance', 'حاضری'], ['Task history', 'کام کی تاریخ'], ['Cleaning schedule', 'صفائی کا شیڈول']]) {
      await page.getByRole('tab', { name: lang === 'ur' ? translated : tab, exact: true }).click();
      if (tab === 'Attendance') await expect(page.getByRole('button', { name: new RegExp('^' + copy('Attendance context', lang) + '(?::|$)') }).filter({ visible: true }).first()).toBeVisible();
      await capture(page, `app-detail-${tab.toLowerCase().replaceAll(' ', '-')}-${width}-${lang}`);
    }
    await page.goto('/managers');
    await expect(exactPerson(page, 'E2E manager A')).toBeVisible();
    await capture(page, `app-managers-${width}-${lang}`);
    await page.getByRole('table').evaluate(element => element.scrollIntoView({ block: 'start' }));
    await capture(page, `app-manager-directory-${width}-${lang}`);
    observations.push({ width, lang, routes: ['/staff', `/staff/${fixture.staff.transfer.id}`, '/managers'], overflow: false, errors: [...errors], provenance: 'Actual API and synthetic SQL. Detail uses V5 conventions because prototype detail is a placeholder.' });
    expect(errors).toEqual([]); await context.close();
  }
  await writeFile(join(out, 'render-results.json'), JSON.stringify(observations, null, 2));
});

test('V5 access forms and actual open-shift conflict preserve reason and destination in English Urdu', async ({ browser }) => {
  test.setTimeout(150000);
  for (const width of [1366, 390]) for (const lang of ['en', 'ur']) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await enter(page, `/staff/${fixture.staff.openShift.id}`, 'ownerA', lang);
    const dialog = await access(page, lang); const select = dialog.getByRole('combobox').first();
    await expect(select.getByRole('option', { name: copy('Sign out of all devices', lang), exact: true })).toBeAttached();
    for (const action of ['deactivate', 'archive', 'transfer', 'signOut']) {
      await select.selectOption(action); await capture(page, `app-access-${action}-${width}-${lang}`);
    }
    await select.selectOption('transfer');
    await choose(page, 'Destination site', 'E2E site B', lang, dialog);
    const reason = dialog.getByLabel(lang === 'ur' ? 'وجہ' : 'Reason', { exact: true });
    await reason.fill('V5 open-shift conflict draft');
    const response = page.waitForResponse(r => r.url().includes(`/workforce/staff/${fixture.staff.openShift.id}/transfer/`) && r.request().method() === 'POST');
    await dialog.getByRole('button', { name: lang === 'ur' ? 'رسائی کی تبدیلی کی تصدیق کریں' : 'Confirm access change' }).click();
    expect((await response).status()).toBe(409);
    await expect(dialog.getByRole('alert')).toBeVisible(); await expect(reason).toHaveValue('V5 open-shift conflict draft');
    await expect(dialog.getByRole('button', { name: new RegExp('^' + copy('Destination site', lang) + ':') })).toContainText('E2E site B');
    expect((await sql('SELECT "locationId" FROM "Staff" WHERE id=$1', [fixture.staff.openShift.id]))[0].locationId).toBe(fixture.site.A);
    await capture(page, `app-access-conflict-${width}-${lang}`);
    await dialog.getByRole('button', { name: lang === 'ur' ? 'رسائی کی تفصیل تازہ کریں' : 'Refresh access context', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(lang === 'ur' ? 'تازہ ہو گئی' : 'Access context refreshed');
    await expect(reason).toHaveValue('V5 open-shift conflict draft');
    await expect(dialog.getByRole('button', { name: new RegExp('^' + copy('Destination site', lang) + ':') })).toContainText('E2E site B');
    await capture(page, `app-access-refreshed-draft-${width}-${lang}`); await context.close();
  }
});

test('Team search location and manager boundaries use actual API reads', async ({ page }) => {
  await enter(page, '/staff', 'managerA'); await expect(exactPerson(page, 'E2E staff transfer')).toBeVisible();
  await page.getByRole('button', { name: /^Filter by location:/ }).click();
  await expect(page.getByRole('menuitemradio', { name:'E2E site B', exact:true })).toHaveCount(0);await page.keyboard.press('Escape');
  const directory = await page.request.get(backend + '/api/staff/'); expect(directory.status()).toBe(200);
  expect(JSON.stringify(await directory.json())).not.toContain(fixture.staff.foreign.email);
  await page.getByRole('searchbox', { name: 'Search team', exact: true }).fill('unmatched-V5-synthetic-person');
  await expect(page.getByText('E2E staff transfer', { exact: true })).toHaveCount(0);
  await capture(page, 'app-team-no-matches-1366-en');
  await page.getByRole('searchbox', { name: 'Search team', exact: true }).fill('');
  await choose(page, 'Filter by location', 'E2E site A'); await expect(page).toHaveURL(new RegExp('locationId=' + fixture.site.A));
  expect((await page.request.get(backend + `/api/staff/details/${fixture.staff.foreign.id}`)).status()).toBe(404);
  await page.goto(`/staff/${fixture.staff.foreign.id}`); await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Staff access', exact: true })).toHaveCount(0);
  await capture(page, 'app-detail-foreign-denied-1366-en');
});

test('V5 staff and manager forms render the current fields and actual scoped sites', async ({ browser }) => {
  test.setTimeout(150000);
  for (const width of [1366, 390]) for (const lang of ['en', 'ur']) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }); const page = await context.newPage();
    await enter(page, '/staff?create=1', 'managerA', lang);
    await expect(page.getByLabel(ui('Full Name'), { exact: true })).toBeVisible();
    await expect(page.getByLabel(ui('Phone Number'), { exact: true })).toHaveValue('');
    await expect(page.getByLabel(ui('Email (optional)'), { exact: true })).toHaveValue('');
    await expect(page.getByLabel(ui('Password'), { exact: true })).toHaveCount(0);
    await capture(page, `app-team-hire-${width}-${lang}`);
    await page.getByRole('dialog').getByRole('button', { name: new RegExp('^' + copy('Location', lang) + ':') }).click();await expect(page.getByRole('menuitemradio', {name:'E2E site B',exact:true})).toHaveCount(0);await page.keyboard.press('Escape');
    await page.goto(`/staff/${fixture.staff.transfer.id}`);
    await page.getByRole('button', { name: lang === 'ur' ? 'ترمیم کریں' : 'Edit', exact: true }).click();
    await expect(page.getByRole('dialog').getByLabel(ui('Full Name'), { exact: true })).toHaveValue('E2E staff transfer');
    await capture(page, `app-staff-edit-${width}-${lang}`);
    await page.goto('/managers'); await expect(page).toHaveURL(/\/dashboard(?:[?#]|$)/);
    await enter(page, '/managers', 'ownerA', lang);
    const row = page.getByRole('row').filter({ hasText: 'E2E manager A' });
    await row.getByRole('button', { name: lang === 'ur' ? 'ترمیم کریں' : 'Edit', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.getByRole('dialog').getByLabel(ui('Password'), {exact:true})).toHaveCount(0);
    await capture(page, `app-manager-edit-${width}-${lang}`); await page.keyboard.press('Escape');
    await row.getByRole('button', { name: lang === 'ur' ? 'رسائی کا انتظام' : 'Manage access', exact: true }).click();
    for (const action of ['deactivate', 'archive']) { await page.getByRole('dialog').getByRole('combobox').selectOption(action); await capture(page, `app-manager-${action}-${width}-${lang}`); }
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: lang === 'ur' ? 'مینیجر شامل کریں' : 'Add manager', exact: true }).click();
    await expect(page.getByRole('dialog').getByLabel(ui('Password'), {exact:true})).toHaveValue(''); await capture(page, `app-manager-create-${width}-${lang}`);
    await context.close();
  }
});

test('V5 Team loading and network error recover using actual forwarded reads', async ({ browser }) => {
  test.setTimeout(90000);
  for (const lang of ['en', 'ur']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } }); const page = await context.newPage();
    let release!: () => void;
    const heldRead = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/staff/', async route => { await heldRead; await route.continue(); });
    await enter(page, '/staff', 'ownerA', lang);
    await expect(page.getByRole('heading', { name: ui('Your people, at a glance'), level: 1 })).toBeVisible();
    await expect(page.getByRole('main').getByRole('status')).toBeVisible();
    await capture(page, `app-team-forwarded-loading-390-${lang}`); release();
    await expect(exactPerson(page, 'E2E staff transfer')).toBeVisible();
    await page.unroute('**/api/staff/');
    // Explicit frontend transport fault seam; no positive API response is replaced.
    await page.route('**/api/staff/', route => route.abort('failed')); await page.reload();
    await expect(page.getByRole('alert').first()).toBeVisible(); await capture(page, `app-team-network-abort-390-${lang}`);
    await page.unroute('**/api/staff/');
    await page.getByRole('button', { name: lang === 'ur' ? 'دوبارہ کوشش کریں' : 'Retry', exact: true }).first().click();
    await expect(exactPerson(page, 'E2E staff transfer')).toBeVisible(); await context.close();
  }
});

test('V5 inline hire and detail edit persist through reload without changing assigned location', async ({ page }) => {
  await enter(page, '/staff?create=1', 'ownerB');
  await page.getByLabel(ui('Full Name'), { exact: true }).fill('Newly Hired Worker'); await page.getByLabel(ui('Email (optional)'), { exact: true }).fill('v5-hired@example.invalid');
  await page.getByLabel(ui('Phone Number'), { exact: true }).fill('+923001234567');
  await choose(page, 'Location (optional)', 'E2E site foreign');
  await page.getByLabel(ui('Shift Start'), { exact: true }).fill('09:00'); await page.getByLabel(ui('Shift End'), { exact: true }).fill('17:00');
  const created = page.waitForResponse(r => r.url().endsWith('/staff/create-staff') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create staff', exact: true }).click(); expect((await created).status()).toBe(201);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(exactPerson(page, 'Newly Hired Worker')).toBeVisible();
  const record = await sql('SELECT id,"locationId" FROM "Staff" WHERE email=$1', ['v5-hired@example.invalid']);
  expect(record).toHaveLength(1); expect(record[0].locationId).toBe(fixture.site.foreign);
  await page.goto(`/staff/${record[0].id}`); await expect(page.getByRole('heading', { name: 'Newly Hired Worker', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click(); const dialog = page.getByRole('dialog');
  await dialog.getByLabel(ui('Full Name'), { exact: true }).fill('Renamed Worker'); await dialog.getByLabel(ui('Phone Number'), { exact: true }).fill('+923007654321');
  const edited = page.waitForResponse(r => r.url().endsWith(`/staff/${record[0].id}`) && r.request().method() === 'PATCH');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click(); expect((await edited).status()).toBe(200);
  await expect(dialog).not.toBeVisible(); await page.reload();
  await expect(page.getByRole('heading', { name: 'Renamed Worker', exact: true })).toBeVisible();
  expect((await sql('SELECT name,phone,"locationId" FROM "Staff" WHERE id=$1', [record[0].id]))[0]).toMatchObject({ name: 'Renamed Worker', phone: '+923007654321', locationId: fixture.site.foreign });
});

test('V5 real empty workforce differs from filtered no matches', async ({ browser }) => {
  test.setTimeout(90000);
  const before = await sql('SELECT id,"isActive" FROM "Staff" WHERE "companyId"=$1', [fixture.company.B]);
  try {
    await sql('UPDATE "Staff" SET "isActive"=false WHERE "companyId"=$1', [fixture.company.B]);
    for (const width of [1366, 390]) for (const lang of ['en', 'ur']) {
      const context = await browser.newContext({ viewport: { width, height: 900 } }); const page = await context.newPage();
      await enter(page, '/staff', 'ownerReturn0', lang); await expect(page.getByRole('heading', { name: copy('Your people, at a glance', lang), exact: true })).toBeVisible();
      await expect(page.getByText('E2E staff foreign', { exact: true })).toHaveCount(0); await capture(page, `app-team-empty-${width}-${lang}`); await context.close();
    }
  } finally { for (const row of before) await sql('UPDATE "Staff" SET "isActive"=$2 WHERE id=$1', [row.id, row.isActive]); }
});

test('actual exhausted plan rejects a hire without losing the form or inserting staff', async ({ page }) => {
  await enter(page, '/staff?create=1');
  await page.getByLabel(ui('Full Name'), { exact: true }).fill('Over Capacity Worker');
  await page.getByLabel(ui('Email (optional)'), { exact: true }).fill('v5-capacity-denied@example.invalid');
  await page.getByLabel(ui('Phone Number'), { exact: true }).fill('+923001234567');
  await choose(page, 'Location (optional)', 'E2E site A');
  await page.getByLabel(ui('Shift Start'), { exact: true }).fill('09:00');
  await page.getByLabel(ui('Shift End'), { exact: true }).fill('17:00');
  const response = page.waitForResponse(r => r.url().endsWith('/staff/create-staff') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create staff', exact: true }).click();
  expect((await response).status()).toBe(403);
  await expect(page.getByRole('alert')).toContainText('capacity has been reached');
  await expect(page.getByLabel(ui('Full Name'), { exact: true })).toHaveValue('Over Capacity Worker');
  expect(await sql('SELECT id FROM "Staff" WHERE email=$1', ['v5-capacity-denied@example.invalid'])).toHaveLength(0);
  await capture(page, 'app-hire-capacity-denied-1366-en');
});

test('hiring validation exposes associated errors in English Urdu without sending invalid accounts', async ({ browser }) => {
  test.setTimeout(90000);
  for (const width of [1366, 390]) for (const lang of ['en', 'ur']) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(); let writes = 0;
    page.on('request', request => { if (request.method() === 'POST' && (new URL(request.url()).pathname === '/api/staff/create-staff' || new URL(request.url()).pathname === '/api/manager/')) writes++; });
    await enter(page, '/staff?create=1', 'ownerA', lang);
    await page.getByRole('button', { name: lang === 'ur' ? 'عملہ شامل کریں' : 'Create staff', exact: true }).click();
    await expect(page.getByLabel(ui('Full Name'), { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel(ui('Full Name'), { exact: true })).toHaveAccessibleDescription(copy('Full name is required.', lang));
    await capture(page, `app-hire-validation-${width}-${lang}`);
    await page.goto('/managers');
    await page.getByRole('button', { name: lang === 'ur' ? 'مینیجر شامل کریں' : 'Add manager', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: lang === 'ur' ? 'مینیجر بنائیں' : 'Create manager', exact: true }).click();
    await expect(page.getByRole('dialog').getByLabel(ui('Manager Name'), {exact:true})).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('dialog').getByLabel(ui('Manager Name'), {exact:true})).toHaveAccessibleDescription(lang === 'ur' ? 'نام ضروری ہے' : 'Name is required');
    await capture(page, `app-manager-validation-${width}-${lang}`);
    expect(writes).toBe(0); await context.close();
  }
});
