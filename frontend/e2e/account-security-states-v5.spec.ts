import { test, expect, enter, fixture } from './fixtures';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const out = fileURLToPath(new URL('./.artifacts/evidence/v5-account-state-evidence/', import.meta.url));
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('own-security pending denied and disconnected states retain recovery in English and Urdu', async ({ browser }) => {
  test.setTimeout(90000);
  await mkdir(out, { recursive: true });
  const results: unknown[] = [];
  for (const language of ['en', 'ur']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await enter(page, '/account/security', 'managerA', language);
    const current = page.locator('input[name="currentPassword"]');
    const next = page.locator('input[name="newPassword"]');
    const confirmation = page.locator('input[name="confirmPassword"]');
    const fill = async () => {
      await current.fill('synthetic-incorrect-current-password');
      await next.fill(fixture.password + '-new');
      await confirmation.fill(fixture.password + '-new');
    };
    const scrub = async () => { await current.fill(''); await next.fill(''); await confirmation.fill(''); };
    const capture = async (state: string, provenance: string) => {
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
      expect(errors).toEqual([]);
      expect(await current.inputValue()).toBe('');
      expect(await next.inputValue()).toBe('');
      expect(await confirmation.inputValue()).toBe('');
      await page.screenshot({ path: join(out, `app-security-${state}-390-${language}.png`), fullPage: true });
      results.push({ state, language, width: 390, height: 900, provenance, credentialFields: 'empty', overflow: false, errors: [] });
    };
    let release: () => void = () => {};
    const pause = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/common/security/password', async route => { await pause; await route.continue(); });
    try {
      await fill();
      const request = page.waitForRequest(request => request.url().endsWith('/api/common/security/password') && request.method() === 'POST');
      await page.locator('form button[type="submit"]').click();
      await request;
      await expect(page.locator('form button[type="submit"]')).toBeDisabled();
      await scrub();
      await capture('pending', 'actual React; request paused before forwarding to actual private API; no response replacement');
      const denied = page.waitForResponse(response => response.url().endsWith('/api/common/security/password'));
      release();
      expect((await denied).status()).toBe(403);
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page.locator('form button[type="submit"]')).toBeEnabled();
      await capture('denied', 'actual private API403 from synthetic incorrect current password; no mutation');
    } finally { release(); await page.unroute('**/api/common/security/password'); }
    await page.route('**/api/common/security/password', route => route.abort('failed'));
    await fill();
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByRole('alert')).toContainText(language === 'ur' ? 'رابطہ' : 'connection');
    await scrub();
    await capture('network-error', 'explicit transport abort; NOT server outage/provider proof');
    await page.unroute('**/api/common/security/password');
    await context.close();
  }
  await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 2));
});
