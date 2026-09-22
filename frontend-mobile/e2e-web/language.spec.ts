import { at, button, expect, test, ur } from './support/test';

// Urdu and back, kept after a reload (specs 04, 14, 21, 48).

const TABS = ['My day', 'Tasks', 'History', 'Profile'];

async function tabTexts(page: import('@playwright/test').Page) {
  return (await page.getByRole('tab').filter({ visible: true }).allInnerTexts()).map(text => text.trim()).filter(text => !/^\d+$/.test(text));
}

test('switch to Urdu, reload, and back to English', async ({ page, open }) => {
  await open({ now: at('06:00') });
  await page.getByRole('tab').filter({ hasText: 'Profile' }).click();
  await page.getByRole('tab', { name: 'اردو', exact: true }).last().click();

  const urdu = TABS.map(name => ur(name));
  const check = async () => {
    const texts = await tabTexts(page);
    for (const name of urdu) expect(texts.some(text => text.includes(name)), `tab ${name}`).toBe(true);
    for (const name of TABS) expect(texts.some(text => text.includes(name)), `English tab ${name}`).toBe(false);
    // Right to left: the first tab (My day) sits at the right end of the bar.
    const first = await page.getByRole('tab').filter({ hasText: urdu[0] }).boundingBox();
    const last = await page.getByRole('tab').filter({ hasText: urdu[3] }).boundingBox();
    expect(first!.x).toBeGreaterThan(last!.x);
    await expect(page.getByRole('heading', { name: ur('My details') })).toBeVisible();
    await expect(button(page, ur('Sign out'))).toBeVisible();
  };
  await expect(page.getByRole('tab').filter({ hasText: urdu[0] })).toBeVisible();
  await check();

  await page.reload();
  await page.getByRole('tab').filter({ hasText: urdu[3] }).click();
  await expect(page.getByRole('heading', { name: ur('My details') })).toBeVisible();
  await check();

  await page.getByRole('tab', { name: 'English', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'My details' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab').filter({ hasText: 'My day' })).toBeVisible();
  const texts = await tabTexts(page);
  for (const name of TABS) expect(texts.some(text => text.includes(name)), `tab ${name}`).toBe(true);
  const first = await page.getByRole('tab').filter({ hasText: 'My day' }).boundingBox();
  const last = await page.getByRole('tab').filter({ hasText: 'Profile' }).boundingBox();
  expect(first!.x).toBeLessThan(last!.x);
});

test('the sign in screen switches to Urdu too', async ({ page, open }) => {
  await open({ signedIn: false });
  await page.getByRole('tab', { name: 'اردو', exact: true }).click();
  await expect(page.getByRole('heading', { name: ur('Staff sign in') })).toBeVisible();
  await expect(button(page, ur('Send code'))).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: ur('Staff sign in') })).toBeVisible();
});
