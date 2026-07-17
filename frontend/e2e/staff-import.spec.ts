import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { backend, enter, expect, fixture, login, sql, test } from './fixtures';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const ExcelJS = require('exceljs');
const headers = ['Full Name', 'Phone', 'Email', 'Shift Start', 'Shift End'];
const importUrl = `${backend}/api/location/${fixture.site.A}/staff-import`;
const fileField = 'Completed spreadsheet (.xlsx or .csv, up to 1 MB)';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

const phone = (index: number) => `0397000${String(index).padStart(4, '0')}`;
const normalized = (index: number) => `+92${phone(index).slice(1)}`;
const row = (name: string, index: number, email = '', start = '08:00', end = '16:00') =>
  [name, phone(index), email, start, end];
const upload = (...rows: string[][]) => ({
  file: {
    name: 'staff.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([headers, ...rows].map(cells => cells.join(',')).join('\n')),
  },
});

test.beforeEach(async () => {
  // Existing history fixtures exceed the Starter staffing cap.
  await sql('UPDATE "Staff" SET "isActive" = false WHERE "companyId" = $1', [fixture.company.A]);
});

test.afterEach(async ({ page }) => {
  await expect(page.getByText(/Request failed with status code/i)).toHaveCount(0);
});

async function openImport(page: Page, language: 'en' | 'ur' = 'en') {
  await enter(page, `/locations/${fixture.site.A}?tab=staff`, 'ownerA', language);
  await page.getByRole('button', { name: language === 'ur' ? 'عملہ درآمد کریں' : 'Import Staff', exact: true }).click();
  return page.getByRole('dialog');
}

test('location import uses the phone-first template and persists XLSX and CSV with blank email in English and Urdu', async ({ browser }) => {
  test.setTimeout(120_000);
  for (const width of [1366, 390]) {
    for (const language of ['en', 'ur'] as const) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage();
        const index = (width === 390 ? 2 : 0) + (language === 'ur' ? 1 : 0);
        const isUrdu = language === 'ur';
        const email = isUrdu ? `import-${index}@example.invalid` : '';
        const dialog = await openImport(page, language);
        await expect(dialog).toContainText('E2E site A');
        const download = page.waitForEvent('download');
        await dialog.getByRole('button', { name: isUrdu ? 'ایکسل سانچہ ڈاؤن لوڈ کریں' : 'Download Excel Template' }).click();
        expect((await download).suggestedFilename()).toBe('staff-template.xlsx');
        const template = await page.request.get(importUrl + '/template');
        expect(template.status()).toBe(200);
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(await template.body());
        expect(book.worksheets[0].getRow(1).values.slice(1)).toEqual([...headers, 'Work days']);

        const name = `Imported Worker ${index + 1}`;
        const cells = row(name, index, email, '22:00', '06:00');
        let file = upload(cells).file;
        if (!isUrdu) {
          book.worksheets[0].addRow(cells);
          file = {
            name: 'staff.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            buffer: Buffer.from(await book.xlsx.writeBuffer()),
          };
        }
        await dialog.getByLabel(isUrdu ? 'مکمل شیٹ (.xlsx یا .csv، زیادہ سے زیادہ ۱ ایم بی)' : fileField, { exact: true }).setInputFiles(file);
        await expect(dialog.getByText(name, { exact: true }).filter({ visible: true })).toBeVisible();
        if (!email) await expect(dialog.getByText('No email', { exact: true }).filter({ visible: true })).toBeVisible();
        expect(await sql('SELECT id FROM "Staff" WHERE phone = $1', [normalized(index)])).toHaveLength(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

        const confirmed = page.waitForResponse(response => response.url().endsWith('/staff-import/confirm'));
        await dialog.getByRole('button', { name: isUrdu ? 'درآمد کی تصدیق' : 'Confirm Import' }).click();
        const response = await confirmed;
        expect(response.status()).toBe(200);
        expect(JSON.stringify(await response.json()).includes(fixture.password)).toBe(false);
        await expect(dialog.getByText(isUrdu ? /ملازمین درآمد ہوئے:/ : /employees imported into/)).toBeVisible();
        const [staff] = await sql('SELECT id, "companyId", "locationId", email, "shiftStart", "shiftEnd", "mustChangePassword", password FROM "Staff" WHERE phone = $1',
          [normalized(index)]);
        expect(staff).toMatchObject({
          companyId: fixture.company.A, locationId: fixture.site.A, email: email || null, mustChangePassword: false,
        });
        expect(staff.password).toMatch(/^\$2[aby]\$/);
        expect(new Date(staff.shiftStart).toISOString()).toBe('1970-01-01T17:00:00.000Z');
        expect(new Date(staff.shiftEnd).toISOString()).toBe('1970-01-01T01:00:00.000Z');
        const [audit] = await sql('SELECT "newValue" FROM "AuditLog" WHERE action = $1 AND "entityId" = $2 ORDER BY id DESC LIMIT 1',
          ['STAFF_IMPORT_COMMITTED', fixture.site.A]);
        expect(JSON.stringify(audit).includes(fixture.password)).toBe(false);

        await dialog.getByRole('button', { name: isUrdu ? 'مکمل' : 'Done', exact: true }).click();
        await page.reload();
        await expect(page.getByText(name, { exact: true }).filter({ visible: true })).toBeVisible();
        await expect(page.getByText(/Request failed with status code/i)).toHaveCount(0);
        await sql('UPDATE "Staff" SET "isActive" = false WHERE id = $1', [staff.id]);
      } finally {
        await context.close();
      }
    }
  }
});

test('bulk import reports bad rows and a corrected file persists with optional email', async ({ page }) => {
  await sql('UPDATE "Company" SET plan = $2 WHERE id = $1', [fixture.company.A, 'ADVANCED']);
  await sql('UPDATE "PaddleSubscription" SET "priceId" = $2 WHERE "companyId" = $1', [fixture.company.A, 'pri_00000000000000000000000003']);
  const dialog = await openImport(page);
  const input = dialog.getByLabel(fileField, { exact: true });
  const [one, two, three, four, five] = [
    row('Phone Only Import', 20), row('Duplicate Import', 21),
    row('Email Import', 22, 'valid@example.invalid'), row('Named Import', 23), row('Shift Import', 24),
  ];
  const bad = [
    one, [two[0], normalized(20), '', '08:00', '16:00'],
    [three[0], 'abc', 'invalid-email', '08:00', '16:00'],
    ['', four[1], '', '08:00', '16:00'], [five[0], five[1], '', '08:00', ''],
  ];
  await input.setInputFiles(upload(...bad).file);
  for (const message of [
    'Duplicate phone in this spreadsheet.', 'Enter a Pakistan mobile number, like 03001234567.',
    'Enter a valid email.', 'Enter a name between 2 and 150 characters.',
    'Enter different shift times in HH:mm format.',
  ]) {
    await expect(dialog.getByText(message, { exact: true }).filter({ visible: true })).toBeVisible();
  }
  const confirm = dialog.getByRole('button', { name: 'Confirm Import' });
  await expect(confirm).toBeDisabled();
  expect(await sql('SELECT id FROM "Staff" WHERE phone = $1', [normalized(20)])).toHaveLength(0);
  await input.setInputFiles(upload(one, two, three, four, five).file);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog.getByText(/5 employees imported into/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  for (const cells of [one, two, three, four, five]) {
    await expect(page.getByText(cells[0], { exact: true }).filter({ visible: true })).toBeVisible();
  }
  expect(await sql('SELECT email FROM "Staff" WHERE phone = $1', [normalized(20)])).toEqual([{ email: null }]);
});

test('import denies unauthorized actors, serializes confirmation and rolls back a failed batch', async ({ page }) => {
  test.setTimeout(60_000);
  const denied = upload(row('Denied Worker', 50, 'denied@example.invalid'));
  for (const [who, status] of [['managerB', 403], ['foreign', 403], ['ownerB', 404]] as const) {
    await login(page.request, who);
    expect((await page.request.post(importUrl + '/preview', { multipart: denied })).status()).toBe(status);
  }
  await login(page.request, 'managerA');
  const preview = (content: ReturnType<typeof upload>) => page.request.post(importUrl + '/preview', { multipart: content });
  const confirm = (content: ReturnType<typeof upload>, token: string) =>
    page.request.post(importUrl + '/confirm', { multipart: { ...content, token } });
  const content = upload(row('Concurrent Worker', 51, 'concurrent@example.invalid'));
  const initial = await preview(content);
  expect(initial.status()).toBe(200);
  const { data: { token } } = await initial.json();
  const results = await Promise.all([confirm(content, token), confirm(content, token)]);
  expect(results.map(response => response.status())).toEqual([200, 200]);
  expect(await sql('SELECT id FROM "Staff" WHERE phone = $1', [normalized(51)])).toHaveLength(1);

  const individual = await page.request.post(backend + '/api/staff/create-staff', {
    data: { name: 'Individual Worker', email: 'individual@example.invalid', phone: phone(52), password: fixture.password, locationId: fixture.site.A },
  });
  expect(individual.status()).toBe(201);
  expect((await individual.json()).data.password).toBeUndefined();
  const staleFile = upload(row('Stale Worker', 53, 'stale@example.invalid'));
  const stale = await preview(staleFile);
  expect(stale.status()).toBe(200);
  await sql('DELETE FROM "ManagerLocation" WHERE "managerId" = $1 AND "locationId" = $2', [fixture.users.managerA.id, fixture.site.A]);
  try {
    expect((await confirm(staleFile, (await stale.json()).data.token)).status()).toBe(403);
  } finally {
    await sql('INSERT INTO "ManagerLocation" ("managerId", "locationId") VALUES ($1, $2)', [fixture.users.managerA.id, fixture.site.A]);
  }

  await sql(`CREATE FUNCTION import_test_failure() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN IF NEW.email = 'rollback2@example.invalid' THEN RAISE EXCEPTION 'synthetic import failure'; END IF; RETURN NEW; END $body$`);
  try {
    await sql('CREATE TRIGGER import_test_failure BEFORE INSERT ON "Staff" FOR EACH ROW EXECUTE FUNCTION import_test_failure()');
    const batch = upload(row('Rollback One', 54, 'rollback1@example.invalid'), row('Rollback Two', 55, 'rollback2@example.invalid'));
    await sql('UPDATE "Staff" SET "isActive" = false WHERE phone IN ($1, $2)', [normalized(51), normalized(52)]);
    const check = await preview(batch);
    expect(check.status()).toBe(200);
    expect((await confirm(batch, (await check.json()).data.token)).status()).toBeGreaterThanOrEqual(400);
    expect(await sql('SELECT id FROM "Staff" WHERE phone IN ($1, $2)', [normalized(54), normalized(55)])).toHaveLength(0);
  } finally {
    await sql('DROP TRIGGER IF EXISTS import_test_failure ON "Staff"');
    await sql('DROP FUNCTION IF EXISTS import_test_failure()');
  }
});

test('200 employee batch fits Enterprise capacity and 500 row preview refuses excess capacity', async ({ page }) => {
  test.setTimeout(90_000);
  await sql('UPDATE "Company" SET plan = $2 WHERE id = $1', [fixture.company.A, 'ADVANCED']);
  await sql('UPDATE "PaddleSubscription" SET "priceId" = $2 WHERE "companyId" = $1', [fixture.company.A, 'pri_00000000000000000000000003']);
  await login(page.request);
  const rows = (count: number) => Array.from({ length: count }, (_, index) =>
    row(`Batch Worker ${index}`, 100 + index, `batch${index}@example.invalid`, '22:00', '06:00'));
  expect((await page.request.post(importUrl + '/preview', { multipart: upload(...rows(500)) })).status()).toBe(403);
  const file = upload(...rows(200));
  const preview = await page.request.post(importUrl + '/preview', { multipart: file });
  expect(preview.status()).toBe(200);
  const { data: { token } } = await preview.json();
  const result = await page.request.post(importUrl + '/confirm', { multipart: { ...file, token }, timeout: 60_000 });
  expect(result.status()).toBe(200);
  expect((await result.json()).data.count).toBe(200);
  expect((await sql('SELECT count(*)::int AS count FROM "Staff" WHERE "companyId" = $1 AND email LIKE $2',
    [fixture.company.A, 'batch%@example.invalid']))[0].count).toBe(200);
});
