import { test, expect, enter, fixture, backend, sql, openShiftAttendancePath } from './fixtures';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { copy, ui, calendar } from './workspace-helpers';
import type { Page } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, 'frontend/e2e/.artifacts/evidence/v5-attendance-evidence');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
async function capture(page: Page, name: string) {
  const width = /-(1366|390)-/.exec(name)?.[1];
  if (width && page.viewportSize()?.width !== Number(width)) await page.setViewportSize({ width: Number(width), height: 900 });
  await mkdir(out, { recursive: true }); await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  const dialog = page.getByRole('dialog').filter({ visible: true });
  if (await dialog.count()) await expect(dialog).toHaveCSS('opacity', '1');
  await page.screenshot({ path: join(out, name + '.png'), animations: 'disabled' });
}

test('V5 attendance register and context render actual records in desktop phone English Urdu', async ({ browser }) => {
  test.setTimeout(150000); const observations: unknown[] = [];
  for (const width of [1366, 390]) for (const lang of ['en', 'ur']) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }); const page = await context.newPage();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await enter(page, openShiftAttendancePath, 'ownerA', lang);
    await expect(page.getByText('E2E staff openShift', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await capture(page, `app-attendance-${width}-${lang}`);
    await page.getByRole('region', { name: ui('Attendance records') }).evaluate(element => element.scrollIntoView({ block: 'start' }));
    await capture(page, `app-attendance-register-${width}-${lang}`);
    await page.getByRole('button', { name: new RegExp('^' + copy('Attendance context', lang) + '(?::|$)') }).filter({ visible: true }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(lang === 'ur' ? 'اصل محفوظ حقائق' : 'Original captured facts', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('status')).toHaveCount(0);
    await capture(page, `app-context-${width}-${lang}`);
    await dialog.getByRole('button', { name: lang === 'ur' ? 'نوٹ درج کریں' : 'Record note', exact: true }).scrollIntoViewIfNeeded();
    await capture(page, `app-context-form-${width}-${lang}`);
    observations.push({ width, lang, route: '/attendance', overflow: false, errors: [...errors], source: 'Actual API and synthetic SQL; original record and attributable note stay separate. Dialog preserves existing app entry vs reference full-page.' });
    expect(errors).toEqual([]); await context.close();
  }
  await writeFile(join(out, 'render-results.json'), JSON.stringify(observations, null, 2));
});

test('attendance loading and error preserve the filter frame and manager context stays authorized', async ({ browser }) => {
  test.setTimeout(90000);
  for (const lang of ['en', 'ur']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await context.newPage(); let release!: () => void;
    const heldRead = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/attendance/**', async route => {
      if (new URL(route.request().url()).pathname === '/api/attendance/') await heldRead;
      await route.continue();
    });
    await enter(page, openShiftAttendancePath, 'managerA', lang);
    await expect(page.getByLabel(ui('Attendance summary'))).toHaveAttribute('aria-busy', 'true');
    await capture(page, `app-attendance-forwarded-loading-390-${lang}`); release();
    await expect(page.getByText('E2E staff openShift', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await page.unroute('**/api/attendance/**');
    await page.route('**/api/attendance/**', route => new URL(route.request().url()).pathname === '/api/attendance/' ? route.abort('failed') : route.continue());
    await page.reload(); await expect(page.getByRole('region', { name: ui('Attendance records') }).getByRole('alert')).toBeVisible();
    await expect(page.getByLabel(ui('Attendance summary')).locator('strong')).toHaveText(['—', '—', '—', '—']);
    await capture(page, `app-attendance-transport-error-390-${lang}`);
    await page.unroute('**/api/attendance/**');
    await page.getByRole('button', { name: lang === 'ur' ? 'دوبارہ کوشش کریں' : 'Retry', exact: true }).click();
    await expect(page.getByText('E2E staff openShift', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await page.getByRole('button', { name: new RegExp('^' + copy('Attendance context', lang) + '(?::|$)') }).filter({ visible: true }).first().click();
    await expect(page.getByRole('dialog').getByLabel(lang === 'ur' ? 'وجہ (لازمی)' : 'Reason (required)')).toBeVisible();
    await capture(page, `app-context-manager-390-${lang}`);
    await context.close();
  }
});

test('attendance filters use scoped API and empty date results without admitting foreign locations', async ({ page }) => {
  await enter(page, '/attendance', 'managerA');
  await expect(page.getByRole('heading', { name: 'Attendance', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Location:/ }).click();
  await expect(page.getByRole('menuitemradio', { name: 'E2E site B', exact: true })).toHaveCount(0);
  await page.getByRole('menuitemradio', { name: 'E2E site A', exact: true }).click();
  await page.getByText('More filters', { exact: true }).click();
  await calendar(page, 'From date', '2090-01-01');
  await calendar(page, 'To date', '2090-01-02');
  const loaded = page.waitForResponse(r => r.url().includes('/api/attendance') && r.request().method() === 'GET' && new URL(r.url()).searchParams.get('from') === '2090-01-01');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  const response = await loaded; expect(response.status()).toBe(200); expect(new URL(response.url()).searchParams.get('locationId')).toBe(String(fixture.site.A));
  await expect(page.getByRole('region', { name: ui('Attendance records') }).getByText('E2E staff openShift', { exact: true })).toHaveCount(0);
  await expect(page.getByText('No attendance records found for the selected filters.', { exact: true })).toBeVisible();
  await capture(page, 'app-attendance-empty-1366-en');
  const denied = await page.request.get(backend + `/api/attendance?locationId=${fixture.site.foreign}`); expect(denied.status()).toBe(403);
});

test('attendance context actual note and acknowledgement preserve captured facts and history across reload', async ({ page }) => {
  const id = fixture.attendance.legacy;
  const before = await sql('SELECT "checkInTime","checkOutTime",status,"checkInImage" FROM "Attendance" WHERE id=$1', [id]);
  await enter(page, `/staff/${fixture.staff.legacy.id}?tab=attendance`);
  await page.getByRole('button', { name: /^Attendance context(?::|$)/ }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog'); const reason = dialog.getByLabel('Reason (required)');
  await reason.fill('V5 immutable attendance context');
  await dialog.getByRole('button', { name: 'Record note', exact: true }).click();
  await expect(dialog.getByText('Context recorded. Original attendance is unchanged.')).toBeVisible();
  await capture(page, 'app-context-saved-1366-en');
  await dialog.getByRole('button', { name: 'Acknowledge note', exact: true }).last().click();
  await reason.fill('V5 attributable acknowledgement');
  await dialog.getByRole('button', { name: 'Record acknowledgement', exact: true }).click();
  await expect(dialog.getByText('V5 attributable acknowledgement', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click(); await page.reload();
  await page.getByRole('button', { name: /^Attendance context(?::|$)/ }).filter({ visible: true }).first().click();
  await expect(dialog.getByText('V5 immutable attendance context', { exact: true })).toBeVisible();
  await expect(dialog.getByText('V5 attributable acknowledgement', { exact: true })).toBeVisible();
  expect(await sql('SELECT "checkInTime","checkOutTime",status,"checkInImage" FROM "Attendance" WHERE id=$1', [id])).toEqual(before);
});

test('attendance context transport error retains draft and exact request retry records once', async ({ page }) => {
  await enter(page, `/staff/${fixture.staff.openShift.id}?tab=attendance`);
  await page.getByRole('button', { name: /^Attendance context(?::|$)/ }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog'); const reason = dialog.getByLabel('Reason (required)');
  await expect(dialog.getByText('No context has been recorded.')).toBeVisible();
  await reason.fill('V5 draft through transport failure');
  await page.route('**/api/attendance/*/annotations', route => route.request().method() === 'POST' ? route.abort('failed') : route.continue());
  await dialog.getByRole('button', { name: 'Record note', exact: true }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: 'Saving was not confirmed.' })).toBeVisible(); await expect(reason).toHaveValue('V5 draft through transport failure');
  await capture(page, 'app-context-transport-draft-1366-en');
  await page.unroute('**/api/attendance/*/annotations'); await dialog.getByRole('button', { name: 'Retry same request', exact: true }).click();
  await expect(dialog.getByText('Context recorded. Original attendance is unchanged.')).toBeVisible();
  expect((await sql('SELECT COUNT(*)::int AS n FROM "AttendanceAnnotation" WHERE "attendanceId"=$1 AND reason=$2', [fixture.attendance.openShift, 'V5 draft through transport failure']))[0].n).toBe(1);
});

test('actual context request conflict preserves the reason and explicit review saves a new note', async ({ browser }) => {
  test.setTimeout(90000);
  const id = fixture.attendance.deactivate;
  for (const width of [1366, 390]) for (const lang of ['en', 'ur']) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }); const page = await context.newPage();
    await enter(page, `/staff/${fixture.staff.deactivate.id}?tab=attendance`, 'ownerA', lang);
    const trigger = page.getByRole('button', { name: new RegExp('^' + copy('Attendance context', lang) + '(?::|$)') }).filter({ visible: true }).first();
    await trigger.click();
    const dialog = page.getByRole('dialog'); const reason = dialog.getByLabel(lang === 'ur' ? 'وجہ (لازمی)' : 'Reason (required)');
    const draft = `V5 conflict draft ${width} ${lang}`;
    await reason.fill(draft); let conflict = true;
    await page.route(`**/api/attendance/${id}/annotations`, async route => {
      if (route.request().method() === 'POST' && conflict) {
        conflict = false;
        // Create an actual competing persisted request with the same ID. Both
        // writes use this authorized synthetic owner; no response is replaced.
        const body = route.request().postDataJSON();
        const concurrent = await page.request.post(route.request().url(), { data: { ...body, reason: `Concurrent saved note ${width} ${lang}` } });
        expect(concurrent.status()).toBe(201);
      }
      await route.continue();
    });
    const failed = page.waitForResponse(r => r.url().endsWith(`/attendance/${id}/annotations`) && r.request().method() === 'POST');
    await dialog.getByRole('button', { name: lang === 'ur' ? 'نوٹ درج کریں' : 'Record note', exact: true }).click();
    expect((await failed).status()).toBe(409); await expect(reason).toHaveValue(draft);
    await capture(page, `app-context-conflict-${width}-${lang}`);
    await dialog.getByRole('button', { name: lang === 'ur' ? 'تضاد دیکھیں اور مسودہ درست کریں' : 'Review conflict and edit draft', exact: true }).click();
    await expect(reason).not.toHaveAttribute('readonly');
    await dialog.getByRole('button', { name: lang === 'ur' ? 'نوٹ درج کریں' : 'Record note', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText(lang === 'ur' ? 'درج ہو گیا' : 'Context recorded');
    expect((await sql('SELECT COUNT(*)::int AS n FROM "AttendanceAnnotation" WHERE "attendanceId"=$1 AND reason=$2', [id, draft]))[0].n).toBe(1);
    await context.close();
  }
});
