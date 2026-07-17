import type { APIRequestContext, APIResponse, Locator, Page } from '@playwright/test';
import { backend, enter, expect, fixture, login, renewSeededStaffCode, sql, test, verifySeededStaffCode } from './fixtures';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

const signin = backend + '/api/common/staff-login';
const localPhone = '0399 0000001';
const normalizedPhone = '+923990000001';
const duplicatePhoneMessage = 'This phone number is already used by another staff member.';
const invalidPhoneMessage = 'Enter a Pakistan mobile number, like 03001234567.';
const createPhoneHint = 'Staff sign in with this phone number and a code sent by SMS.';
const editPhoneHint = 'Changing the phone number signs this person out on every phone.';
const shiftPairMessage = 'Enter both shift start and shift end.';
const editableName = 'Fixture Staff Transfer';

test.afterEach(async ({ page }) => {
  await expect(page.getByText(/Request failed with status code/i)).toHaveCount(0);
});

async function checkError(response: Pick<APIResponse, 'status' | 'json'>, status: number, code: string, message: string, extra = {}) {
  expect(response.status()).toBe(status);
  const body = await response.json();
  expect(body.success).toBe(false);
  expect(body.code === code && body.message === message).toBe(true);
  expect(body.errors.map((error: Record<string, unknown>) => ({
    code: error.code,
    ...Object.fromEntries(Object.keys(extra).map(key => [key, error[key]])),
  }))).toEqual([{ code, ...extra }]);
  expect(body.data === undefined).toBe(true);
}

test('code request rejects unknown and invalid phones, and consumes the row when SMS is unavailable', async ({ request }) => {
  const requestCode = (phone: string) => request.post(signin + '/request-code', { data: { phone } });
  await checkError(await requestCode(normalizedPhone), 404, 'PHONE_NOT_REGISTERED',
    'This number is not registered. Ask your manager to add you.');
  await checkError(await requestCode('invalid'), 400, 'INVALID_PHONE', invalidPhoneMessage);
  const { phone } = fixture.staff.legacy;
  // This case exercises a new request without the resend cooldown from the seed.
  await sql('DELETE FROM "StaffLoginCode" WHERE phone = $1', [phone]);
  await checkError(await requestCode(phone), 503, 'SMS_UNAVAILABLE',
    'The code could not be sent. Try again in a few minutes.');
  const rows = await sql('SELECT "consumedAt" IS NOT NULL AS consumed, length("codeHash") AS "hashLength" FROM "StaffLoginCode" WHERE phone = $1', [phone]);
  expect(rows).toEqual([{ consumed: true, hashLength: 64 }]);
});

test('a wrong code leaves four tries and the seeded code issues the existing staff session shape', async ({ request }) => {
  const who = 'recovery';
  await sql('UPDATE "Staff" SET email = NULL WHERE id = $1', [fixture.staff[who].id]);
  await renewSeededStaffCode(who);
  await checkError(await verifySeededStaffCode(request, who, true), 400, 'CODE_WRONG',
    'That code is not right. 4 tries left.', { attemptsLeft: 4 });
  const verified = await verifySeededStaffCode(request, who);
  expect(verified.status()).toBe(200);
  const { data: { accessToken, refreshToken, ...identity } } = await verified.json();
  expect(typeof accessToken === 'string' && accessToken.length > 0).toBe(true);
  expect(typeof refreshToken === 'string' && refreshToken.length > 0).toBe(true);
  expect(Object.keys(identity).sort()).toEqual(['companyId', 'email', 'id', 'locationId', 'name', 'role']);
  expect(identity).toEqual({
    id: fixture.staff[who].id, name: 'E2E staff recovery', email: null,
    role: 'STAFF', locationId: fixture.site.A, companyId: fixture.company.A,
  });
  expect(verified.headersArray().filter(header => header.name.toLowerCase() === 'set-cookie')
    .map(header => header.value.split('=')[0]).sort()).toEqual(['accessToken', 'refreshToken']);
  expect((await request.get(backend + '/api/staff/profile/me')).status()).toBe(200);
  await checkError(await verifySeededStaffCode(request, who), 410, 'CODE_EXPIRED',
    'This code has expired. Ask for a new code.');
});

test('the fifth wrong code locks the row and the sixth attempt cannot reuse it', async ({ request }) => {
  const who = 'legacy';
  await renewSeededStaffCode(who);
  for (const attemptsLeft of [4, 3, 2, 1]) {
    await checkError(await verifySeededStaffCode(request, who, true), 400, 'CODE_WRONG',
      `That code is not right. ${attemptsLeft} tries left.`, { attemptsLeft });
  }
  await checkError(await verifySeededStaffCode(request, who, true), 410, 'CODE_LOCKED',
    'Too many wrong tries. Ask for a new code.');
  await checkError(await verifySeededStaffCode(request, who, true), 410, 'CODE_EXPIRED',
    'This code has expired. Ask for a new code.');
  expect(await sql('SELECT attempts, "consumedAt" IS NOT NULL AS consumed FROM "StaffLoginCode" WHERE phone = $1',
    [fixture.staff[who].phone])).toEqual([{ attempts: 5, consumed: true }]);
});

test('old app sign-in returns the app update message', async ({ request }) => {
  await checkError(await request.post(backend + '/api/staff/staff-login', {
    data: { email: fixture.staff.transfer.email, password: fixture.password },
  }), 410, 'APP_UPDATE_REQUIRED', 'Update the Hygene Ops app to sign in with your phone number.');
});

const field = (dialog: Locator, name: string) => dialog.getByLabel(name, { exact: true });

async function openAdd(page: Page) {
  await page.getByRole('button', { name: 'Add team member', exact: true }).first().click();
  return page.getByRole('dialog');
}

async function openEdit(page: Page) {
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  return page.getByRole('dialog');
}

async function useInvalidFields(dialog: Locator) {
  await field(dialog, 'Full Name').fill('');
  await field(dialog, 'Phone Number').fill('abc');
  await field(dialog, 'Email (optional)').fill('not-an-address');
  await field(dialog, 'Shift Start').fill('08:00');
  await field(dialog, 'Shift End').fill('');
}

async function checkInvalidFields(dialog: Locator, phoneHint: string) {
  for (const [label, message] of [
    ['Full Name', 'Full name is required.'],
    ['Phone Number', `${phoneHint} ${invalidPhoneMessage}`],
    ['Email (optional)', 'Enter a valid email, like name@example.com.'],
  ]) {
    await expect(field(dialog, label)).toHaveAccessibleDescription(message);
  }
}

test('owner creates phone-only staff and a second format of the same phone is refused', async ({ page }) => {
  await sql('UPDATE "Staff" SET "isActive" = false WHERE "companyId" = $1', [fixture.company.A]);
  await enter(page, '/staff');
  let dialog = await openAdd(page);
  await expect(dialog.getByLabel(/password/i)).toHaveCount(0);
  await field(dialog, 'Full Name').fill('Phone Only Worker');
  await field(dialog, 'Phone Number').fill(localPhone);
  const created = page.waitForResponse(response => response.url().endsWith('/api/staff/create-staff') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Create staff', exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).not.toHaveProperty('password');
  await expect(dialog).toBeHidden();
  await page.reload();
  const row = page.getByRole('row').filter({ hasText: 'Phone Only Worker' });
  await expect(row.getByText('No email', { exact: true })).toBeVisible();
  await expect(row.getByText(normalizedPhone, { exact: true })).toBeVisible();

  dialog = await openAdd(page);
  await field(dialog, 'Full Name').fill('Duplicate Phone Worker');
  await field(dialog, 'Phone Number').fill(normalizedPhone);
  const conflict = page.waitForResponse(response => response.url().endsWith('/api/staff/create-staff') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Create staff', exact: true }).click();
  await checkError(await conflict, 409, 'PHONE_IN_USE', duplicatePhoneMessage);
  await expect(field(dialog, 'Phone Number')).toHaveAccessibleDescription(`${createPhoneHint} ${duplicatePhoneMessage}`);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await expect(row).toBeVisible();
  await expect(page.getByText('Duplicate Phone Worker', { exact: true })).toHaveCount(0);
  expect(await sql('SELECT name, email FROM "Staff" WHERE phone = $1', [normalizedPhone]))
    .toEqual([{ name: 'Phone Only Worker', email: null }]);
});

test('add form shows name, phone and email errors and sends no create request', async ({ page }) => {
  await sql('UPDATE "Staff" SET "isActive" = false WHERE "companyId" = $1', [fixture.company.A]);
  await enter(page, '/staff');
  const count = async () => (await sql('SELECT count(*)::int AS count FROM "Staff"'))[0].count;
  const before = await count();
  let writes = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/api/staff/create-staff')) writes++;
  });
  const dialog = await openAdd(page);
  await useInvalidFields(dialog);
  await dialog.getByRole('button', { name: 'Create staff', exact: true }).click();
  await checkInvalidFields(dialog, createPhoneHint);
  expect(writes).toBe(0);
  expect(await count()).toBe(before);
});

test('add form shows the missing shift end error alongside other field errors', async ({ page }) => {
  await sql('UPDATE "Staff" SET "isActive" = false WHERE "companyId" = $1', [fixture.company.A]);
  await enter(page, '/staff');
  const dialog = await openAdd(page);
  await useInvalidFields(dialog);
  await dialog.getByRole('button', { name: 'Create staff', exact: true }).click();
  await expect(field(dialog, 'Shift End')).toHaveAccessibleDescription(`Times use the assigned site’s timezone. ${shiftPairMessage}`);
});

test('edit form shows four field errors and a conflicting phone leaves the saved record intact', async ({ page }) => {
  const { id, phone, email } = fixture.staff.transfer;
  await sql('UPDATE "Staff" SET name = $2 WHERE id = $1', [id, editableName]);
  await enter(page, `/staff/${id}`);
  const dialog = await openEdit(page);
  const editPath = `/api/staff/${id}`;
  let writes = 0;
  page.on('request', request => {
    if (request.method() === 'PATCH' && request.url().endsWith(editPath)) writes++;
  });
  const save = dialog.getByRole('button', { name: 'Save changes', exact: true });
  await useInvalidFields(dialog);
  await save.click();
  await checkInvalidFields(dialog, editPhoneHint);
  await expect(field(dialog, 'Shift End')).toHaveAccessibleDescription(`Times use the assigned site’s timezone. Asia/Karachi ${shiftPairMessage}`);
  expect(writes).toBe(0);

  await field(dialog, 'Full Name').fill(editableName);
  await field(dialog, 'Email (optional)').fill(email);
  await field(dialog, 'Phone Number').fill(fixture.staff.archive.phone);
  await field(dialog, 'Shift Start').fill('');
  const conflict = page.waitForResponse(response => response.url().endsWith(editPath) && response.request().method() === 'PATCH');
  await save.click();
  await checkError(await conflict, 409, 'PHONE_IN_USE', duplicatePhoneMessage);
  await expect(field(dialog, 'Phone Number')).toHaveAccessibleDescription(`${editPhoneHint} ${duplicatePhoneMessage}`);
  expect(writes).toBe(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: editableName, exact: true })).toBeVisible();
  const reopened = await openEdit(page);
  await expect(field(reopened, 'Full Name')).toHaveValue(editableName);
  await expect(field(reopened, 'Phone Number')).toHaveValue(phone);
  await expect(field(reopened, 'Email (optional)')).toHaveValue(email);
  await expect(field(reopened, 'Shift Start')).toHaveValue('');
  await expect(field(reopened, 'Shift End')).toHaveValue('');
});

async function expectManagerPhoneChange(page: Page, request: APIRequestContext) {
  const { id } = fixture.staff.transfer;
  await login(request, 'transfer');
  expect((await request.get(backend + '/api/staff/profile/me')).status()).toBe(200);
  await enter(page, `/staff/${id}`, 'managerA');
  const dialog = await openEdit(page);
  await field(dialog, 'Phone Number').fill(localPhone);
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByText(normalizedPhone, { exact: true }).first()).toBeVisible();
  expect((await request.post(backend + '/api/common/refresh-token')).status()).toBe(401);
}

test('assigned manager changes the phone and the previous staff refresh session is refused', async ({ page, request }) => {
  await sql('UPDATE "Staff" SET name = $2 WHERE id = $1', [fixture.staff.transfer.id, editableName]);
  await expectManagerPhoneChange(page, request);
});

test('assigned manager can change the phone when the existing staff name contains a digit', async ({ page, request }) => {
  await expectManagerPhoneChange(page, request);
});
