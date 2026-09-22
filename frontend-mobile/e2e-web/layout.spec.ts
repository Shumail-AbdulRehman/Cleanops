import { at, button, expect, expectNoHorizontalOverflow, tab, test, ur, type Language } from './support/test';
import { attendance, checkedIn, feed, task } from './support/data';

// No horizontal overflow on every main screen, in English and Urdu. The `small` project is the
// 360 by 700 window the design requires; `phone` runs the same walk at 390 by 844.

const say = (language: Language, english: string) => (language === 'ur' ? ur(english) : english);

for (const language of ['en', 'ur'] as const) {
  test(`every main screen fits the width (${language})`, async ({ page, api, open }) => {
    api.on('GET', '/staff/mobile/attendance', attendance(checkedIn()));
    api.on('GET', '/staff/mobile/tasks', feed(
      task(501, 'Ground floor washroom and the long corridor by the stairs', { status: 'IN_PROGRESS', verificationState: 'CAPTURING' }),
      task(502, 'Reception lobby', { shiftStart: '2026-11-12T07:00:00.000Z', shiftEnd: '2026-11-12T08:00:00.000Z' }),
    ));
    await open({ now: at('05:30'), language });
    const fits = async (what: string) => {
      await page.waitForLoadState('networkidle');
      await test.step(what, () => expectNoHorizontalOverflow(page));
    };

    await expect(page.getByTestId('day-header-title')).toBeVisible();
    await fits('My day');

    await tab(page, say(language, 'Tasks')).click();
    await expect(page.getByRole('button', { name: /^Reception lobby, / })).toBeVisible();
    await fits('Tasks');

    await page.getByRole('button', { name: /^Reception lobby, / }).click();
    await expect(page.getByTestId('step-1-current')).toBeVisible();
    await fits('Task details');
    await button(page, say(language, 'Back')).click();

    await page.getByRole('button', { name: /^Ground floor washroom and the long corridor/ }).click();
    await button(page, say(language, 'Take task photos')).click();
    await expect(page.getByText(say(language, 'Task photos')).filter({ visible: true }).first()).toBeVisible();
    await fits('Task photos');
    await button(page, say(language, 'Back to tasks')).click();
    await button(page, say(language, 'Back')).click();

    await tab(page, say(language, 'History')).click();
    await expect(page.getByRole('button', { name: say(language, 'Previous month') })).toBeVisible();
    await fits('History tasks');
    await page.getByRole('button', { name: /^Staff kitchen, / }).click();
    await expect(page.getByRole('heading', { name: say(language, 'What happened') })).toBeVisible();
    await fits('History task details');
    await button(page, say(language, 'Back')).click();
    await page.getByRole('tab', { name: say(language, 'Attendance'), exact: true }).click();
    await expect(page.getByLabel(new RegExp(`^10 .*${say(language, 'Late')}$`))).toBeVisible();
    await fits('History attendance');

    await tab(page, say(language, 'Profile')).click();
    await expect(page.getByRole('heading', { name: say(language, 'My details') })).toBeVisible();
    await fits('Profile');
    for (const row of ['Task alerts', 'Help']) {
      await button(page, say(language, row)).click();
      await expect(button(page, say(language, 'Back'))).toBeVisible();
      await fits(row);
      await button(page, say(language, 'Back')).click();
    }
  });

  test(`sign in fits the width (${language})`, async ({ page, open }) => {
    await open({ signedIn: false, language });
    await expect(page.getByRole('heading', { name: say(language, 'Staff sign in') })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByLabel(say(language, 'Phone number'), { exact: true }).fill('0399 0000041');
    await button(page, say(language, 'Send code')).click();
    await expect(page.getByLabel(say(language, '6-digit code'), { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}
