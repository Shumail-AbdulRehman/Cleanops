import { test, expect } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { login, backend } from './fixtures';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, 'frontend/e2e/.artifacts/evidence/v5-operator-evidence');
const localPlatform = process.env.HYGENE_E2E_LOCAL_PLATFORM === 'true';
const localSessionPath = '/api/platform/session';
const web = process.env.HYGENE_E2E_WEB_ORIGIN!;
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function allowManagedOrigins(context: BrowserContext) {
  await context.route(/^https?:\/\//, route =>
    [backend, web].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort(),
  );
}

test('actual platform public boundaries match V5 in desktop phone English Urdu without tenant bootstrap', async ({ browser }) => {
  test.setTimeout(120000);
  await mkdir(out, { recursive: true });
  const observations: unknown[] = [];
  for (const width of [1366, 390]) for (const language of ['en', 'ur']) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await allowManagedOrigins(context);
    await context.addInitScript(value => localStorage.setItem('hygene-ops.language', value), language);
    const page = await context.newPage();
    const requests: string[] = [], errors: string[] = [];
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(new URL(request.url()).pathname); });
    page.on('pageerror', error => errors.push(error.message));
    for (const view of ['login', 'security', 'callback']) {
      await page.goto('/platform/' + view + (view === 'callback' ? '?code=untrusted&state=untrusted#access_token=untrusted' : ''));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.locator('html').getAttribute('dir')).toBe(language === 'ur' ? 'rtl' : 'ltr');
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
      if (view === 'callback') {
        await expect(page.locator('input, select')).toHaveCount(0);
        await expect(page.getByRole('alert')).toBeVisible();
        await expect(page).toHaveURL(/\/platform\/callback$/);
      } else if (localPlatform) {
        await expect(page.getByLabel(language === 'ur' ? 'پلیٹ فارم ای میل' : 'Platform email')).toBeVisible();
        await expect(page.getByLabel(language === 'ur' ? 'پاس ورڈ' : 'Password', { exact: true })).toBeVisible();
      } else {
        await expect(page.locator('input, select')).toHaveCount(0);
        await expect(page.locator('.operator-provider-state button')).toBeDisabled();
      }
      for (const button of await page.locator('.operator-access button').all()) {
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(width === 390 ? 48 : 44);
      }
      await page.screenshot({ path: join(out, `app-${view}-${width}-${language}.png`), animations: 'disabled' });
      await page.screenshot({ path: join(out, `app-${view}-full-${width}-${language}.png`), fullPage: true, animations: 'disabled' });
      const reference = await context.newPage();
      await reference.goto('file://' + join(root, 'design/v5/' + (view === 'security' ? 'operator-security' : 'operator-login') + '.html') + '?lang=' + language);
      await reference.evaluate(() => document.fonts.ready);
      await reference.screenshot({ path: join(out, `v5-${view}-${width}-${language}.png`), animations: 'disabled' });
      await reference.close();
      if (view === 'security' && !localPlatform) {
        await page.getByRole('button', { name: language === 'ur' ? 'پلیٹ فارم کا سیشن صاف کریں' : 'Clear platform session', exact: true }).click();
        await expect(page.getByRole('status')).toContainText(language === 'ur' ? 'کمپنی کا سیشن برقرار ہے۔' : 'Your company session is unchanged.');
        await page.screenshot({ path: join(out, `app-security-cleared-${width}-${language}.png`), fullPage: true, animations: 'disabled' });
      }
      observations.push({ view, width, height: 900, language, overflow: false, apiRequests: [...requests], errors: [...errors], localPlatform });
    }
    expect([...new Set(requests)]).toEqual(localPlatform ? [localSessionPath] : []);
    expect(errors).toEqual([]);
    await context.close();
  }
  await writeFile(join(out, 'render-results.json'), JSON.stringify(observations, null, 2));
});

test('operator language navigation and direct protected paths require platform sign-in', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await allowManagedOrigins(context);
  const page = await context.newPage();
  const requests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(new URL(request.url()).pathname); });
  await page.goto('/platform/login');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#auth-content')).toBeFocused();
  await page.getByRole('button', { name: 'اردو', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const title = localPlatform ? 'پلیٹ فارم مالک کا داخلہ' : 'پلیٹ فارم آپریٹر کا داخلہ';
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  for (const route of ['', '/overview', '/companies', '/companies/1', '/subscriptions', '/subscriptions/payments', '/service', '/audit', '/inquiries', '/unknown']) {
    await page.goto('/platform' + route);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    if (localPlatform) {
      await expect(page.getByLabel('پلیٹ فارم ای میل')).toBeVisible();
    } else {
      await expect(page.locator('.operator-provider-state button')).toBeDisabled();
    }
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  }
  expect([...new Set(requests)]).toEqual(localPlatform ? [localSessionPath] : []);
  await context.close();
});

test('real tenant cookies never authorize platform APIs and survive local platform cleanup', async ({ browser }) => {
  for (const who of ['ownerA', 'managerA', 'transfer']) {
    const context = await browser.newContext();
    await allowManagedOrigins(context);
    await login(context.request, who);
    const before = await context.request.get(backend + '/api/common/get-current-user');
    expect(before.status()).toBe(200);
    const identity = (await before.json()).data;
    for (const path of ['/platform/companies', '/platform/service/diagnostics']) {
      const denied = await context.request.get(backend + '/api' + path);
      expect(denied.status()).toBe(401);
      expect((await denied.json()).message).toBe('Platform bearer identity required');
    }
    const page = await context.newPage();
    const requests: string[] = [];
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(new URL(request.url()).pathname); });
    if (localPlatform) {
      const credentials = JSON.parse(readFileSync(process.env.HYGENE_E2E_PLATFORM_OWNER_FILE!, 'utf8'));
      const signedIn = await context.request.post(backend + localSessionPath + '/login', {
        data: credentials,
        headers: { Origin: web },
      });
      expect(signedIn.status()).toBe(200);
    }
    await page.goto('/platform/security');
    if (localPlatform) {
      await page.getByRole('button', { name: 'Sign out of platform', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Platform owner sign-in' })).toBeVisible();
      await expect(page.getByLabel('Platform email')).toBeVisible();
      expect([...new Set(requests)]).toEqual([localSessionPath, localSessionPath + '/logout']);
    } else {
      await page.getByRole('button', { name: 'Clear platform session', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('Your company session is unchanged.');
      expect(requests).toEqual([]);
    }
    const after = await context.request.get(backend + '/api/common/get-current-user');
    expect(after.status()).toBe(200);
    const retained = (await after.json()).data;
    expect({ id: retained.id, role: retained.role, companyId: retained.companyId }).toEqual({ id: identity.id, role: identity.role, companyId: identity.companyId });
    await context.close();
  }
});
