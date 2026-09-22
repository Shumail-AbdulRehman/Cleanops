import { randomInt } from 'node:crypto';
import type { Page } from '@playwright/test';
import { at, button, expect, test, ur, words } from './support/test';
import { codeFingerprint, requestCodePath, verifyCodePath, type Reply } from './support/api';

const typedPhone = '0399 0000041';
const normalizedPhone = '+923990000041';
const NOW = at('04:05');
const rawError = /Request failed with status code/i;

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

function enterCode(page: Page, label: string, length = 6) {
  const code = String(randomInt(10 ** length)).padStart(length, '0');
  const digest = codeFingerprint(code);
  // Use a transient input and pass only its digest back to assertions.
  return page.getByLabel(label, { exact: true }).evaluate((input, value) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, code).then(() => digest);
}

function rejection(status: number, code: string, detail: Record<string, number> = {}): Reply {
  return { status, body: { success: false, code, message: 'Untranslated server detail', errors: [{ code, ...detail }] } };
}

test('phone and SMS code sign in to My day without authorization and survive a reload', async ({ page, api, open }) => {
  await open({ signedIn: false, now: NOW });
  const phone = page.getByLabel('Phone number', { exact: true });
  await phone.fill(typedPhone);
  await button(page, 'Send code').click();
  await expect(page.getByText(words('Enter the 6-digit code we sent to 0399 0000041.'))).toBeVisible();
  const codeDigest = await enterCode(page, '6-digit code');
  await button(page, 'Sign in').click();
  await expect(page.getByTestId('day-header-title')).toHaveText(words('Check in to start your shift'));
  expect(api.callsTo(requestCodePath, 'POST')).toMatchObject([{ body: { phone: typedPhone }, authorized: false }]);
  expect(api.callsTo(verifyCodePath, 'POST')).toMatchObject([{ body: { phone: normalizedPhone, codeDigest }, authorized: false }]);
  expect(api.callsTo('/common/get-current-user').length).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByTestId('day-header-title')).toBeVisible();
  await expect(page.getByText(rawError)).toHaveCount(0);
});

const requestErrors = [
  [400, 'INVALID_PHONE', 'Enter a Pakistan mobile number, like 03001234567.'],
  [404, 'PHONE_NOT_REGISTERED', 'This number is not registered. Ask your manager to add you.'],
  [429, 'CODE_RESEND_WAIT', 'Wait {seconds} seconds before asking for a new code.', { retryAfterSeconds: 34 }, { seconds: 34 }],
  [429, 'PHONE_DAILY_LIMIT', "This number has reached today's code limit. Try again tomorrow or ask your manager."],
  [503, 'SMS_DAILY_LIMIT', 'Sign-in codes are used up for today. Ask your manager.'],
  [503, 'SMS_UNAVAILABLE', 'The code could not be sent. Try again in a few minutes.'],
  [429, 'AUTH_RATE_LIMITED', 'Too many attempts. Try again later.'],
] as const;

const verifyErrors = [
  [400, 'INVALID_PHONE', 'Enter a Pakistan mobile number, like 03001234567.'],
  [400, 'INVALID_REQUEST', 'Enter the 6-digit code.'],
  [400, 'CODE_WRONG', 'That code is not right. {n} tries left.', { attemptsLeft: 4 }, { n: 4 }],
  [410, 'CODE_EXPIRED', 'This code has expired. Ask for a new code.'],
  [410, 'CODE_LOCKED', 'Too many wrong tries. Ask for a new code.'],
  [404, 'PHONE_NOT_REGISTERED', 'This number is not registered. Ask your manager to add you.'],
  [429, 'AUTH_RATE_LIMITED', 'Too many attempts. Try again later.'],
] as const;

for (const language of ['en', 'ur'] as const) {
  const say = (key: string, values?: Record<string, number>) => language === 'ur'
    ? ur(key, values)
    : key.replace(/\{(\w+)\}/g, (placeholder, name: string) => String(values?.[name] ?? placeholder));

  for (const [status, code, message, detail, values] of requestErrors) {
    test(`request error ${code} (${language})`, async ({ page, api, open }) => {
      api.on('POST', requestCodePath, rejection(status, code, detail));
      await open({ signedIn: false, language });
      await page.getByLabel(say('Phone number'), { exact: true }).fill(code === 'INVALID_PHONE' ? '02001234567' : typedPhone);
      await button(page, say('Send code')).click();
      await expect(page.getByText(words(say(message, values)))).toBeVisible();
      await expect(page.getByLabel(say('6-digit code'), { exact: true })).toHaveCount(0);
      await expect(page.getByText(rawError)).toHaveCount(0);
      expect(api.callsTo(requestCodePath, 'POST')).toHaveLength(1);
    });
  }

  for (const [status, code, message, detail, values] of verifyErrors) {
    test(`verify error ${code} (${language})`, async ({ page, api, open }) => {
      api.on('POST', verifyCodePath, rejection(status, code, detail));
      await open({ signedIn: false, language });
      await page.getByLabel(say('Phone number'), { exact: true }).fill(typedPhone);
      await button(page, say('Send code')).click();
      await enterCode(page, say('6-digit code'));
      await button(page, say('Sign in')).click();
      await expect(page.getByText(words(say(message, values)))).toBeVisible();
      await expect(page.getByLabel(say('6-digit code'), { exact: true })).toBeVisible();
      await expect(page.getByText(rawError)).toHaveCount(0);
    });
  }

  test(`empty phone and five-digit code stay on their step (${language})`, async ({ page, api, open }) => {
    await open({ signedIn: false, language });
    await button(page, say('Send code')).click();
    await expect(page.getByText(words(say('Enter your phone number.')))).toBeVisible();
    expect(api.callsTo(requestCodePath, 'POST')).toHaveLength(0);
    await page.getByLabel(say('Phone number'), { exact: true }).fill(typedPhone);
    await button(page, say('Send code')).click();
    await enterCode(page, say('6-digit code'), 5);
    await button(page, say('Sign in')).click();
    await expect(page.getByText(words(say('Enter the 6-digit code.')))).toBeVisible();
    expect(api.callsTo(verifyCodePath, 'POST')).toHaveLength(0);
    await expect(page.getByText(rawError)).toHaveCount(0);
  });
}

async function openCountdown(page: Page) {
  await page.getByLabel('Phone number', { exact: true }).fill(typedPhone);
  await button(page, 'Send code').click();
  await expect(page.getByText('You can ask for a new code in 60 seconds.', { exact: true })).toBeVisible();
}

test('resend waits 60 seconds and Change number returns to the phone step', async ({ page, api, open }) => {
  await open({ signedIn: false, now: NOW });
  await openCountdown(page);
  const resend = button(page, 'Send a new code');
  await page.clock.setFixedTime(new Date(Date.parse(NOW) + 59_000));
  await expect(page.getByText('You can ask for a new code in 1 seconds.', { exact: true })).toBeVisible();
  await resend.press('Enter');
  expect(api.callsTo(requestCodePath, 'POST')).toHaveLength(1);
  await page.clock.setFixedTime(new Date(Date.parse(NOW) + 60_000));
  await expect(page.getByText('You can ask for a new code in 1 seconds.', { exact: true })).toBeHidden();
  await resend.click();
  expect(api.callsTo(requestCodePath, 'POST')).toMatchObject([
    { body: { phone: typedPhone } }, { body: { phone: normalizedPhone } },
  ]);
  await expect(page.getByText('You can ask for a new code in 60 seconds.', { exact: true })).toBeVisible();
  await button(page, 'Change number').click();
  await expect(page.getByLabel('Phone number', { exact: true })).toHaveValue(typedPhone);
  await expect(page.getByLabel('6-digit code', { exact: true })).toHaveCount(0);
  await expect(page.getByText(rawError)).toHaveCount(0);
});

test('resend exposes the disabled state during the countdown', async ({ page, open }) => {
  await open({ signedIn: false, now: NOW });
  await openCountdown(page);
  await expect(button(page, 'Send a new code')).toBeDisabled();
});

test('connection settings stay reachable', async ({ page, open }) => {
  await open({ signedIn: false, now: NOW });
  await button(page, 'Show connection settings').click();
  await expect(page.getByTestId('server-address')).toHaveText('http://api.staff-e2e.test/api');
  await button(page, 'Hide connection settings').click();
  await expect(page.getByTestId('server-address')).toBeHidden();
});
