import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { backend, expect, fixture, login, sql, test } from './fixtures';

const web = process.env.HYGENE_E2E_WEB_ORIGIN!;
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.HYGENE_E2E_LOCAL_PLATFORM !== 'true', 'Explicit isolated local-platform mode is required');

test.beforeEach(async ({ context }) => {
  await context.route(/^https?:\/\//, route =>
    [web, backend].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort(),
  );
});

function operatorCredentials() {
  return JSON.parse(readFileSync(process.env.HYGENE_E2E_PLATFORM_OWNER_FILE!, 'utf8')) as {
    email: string;
    password: string;
  };
}

function signInButton(page: Page) {
  return page.getByRole('button', { name: 'Sign in to platform', exact: true });
}

test('local platform login clears a rejected password and logout revokes access', async ({ page, browser }) => {
  const owner = operatorCredentials();
  await page.goto('/platform/login');
  await page.getByLabel('Platform email').fill(owner.email);
  const password = page.getByLabel('Password', { exact: true });
  await password.fill(owner.password + 'wrong');
  await signInButton(page).click();
  await expect(page.getByRole('alert')).toContainText('Sign-in failed');
  await expect(password).toHaveValue('');
  await password.fill(owner.password);
  await signInButton(page).click();
  await expect(page).toHaveURL(/\/platform\/overview$/);
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();

  const rail = page.getByRole('navigation', { name: 'Main navigation' });
  await rail.getByRole('link', { name: 'Inquiries', exact: true }).click();
  await expect(page).toHaveURL(/\/platform\/inquiries$/);
  await expect(page.getByText('No inquiries yet.')).toBeVisible();
  for (const path of ['/platform/service', '/platform/audit?companyId=' + fixture.company.A]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/platform\/overview$/);
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
  }
  for (const label of ['Service diagnostics', 'Administrative audit']) {
    await expect(rail.getByRole('link', { name: label, exact: true })).toHaveCount(0);
  }

  expect((await page.request.get(backend + '/api/staff/')).status()).toBe(401);
  await page.goto('/platform/security');
  await page.getByRole('button', { name: 'Sign out of platform', exact: true }).click();
  await expect(page.getByLabel('Platform email')).toBeVisible();
  expect((await page.request.get(backend + '/api/platform/companies')).status()).toBe(401);

  const tenant = await browser.newContext();
  try {
    await login(tenant.request, 'ownerA');
    expect((await tenant.request.get(backend + '/api/platform/companies')).status()).toBe(401);
    const wrong = await tenant.request.post(backend + '/api/platform/session/login', {
      headers: { Origin: web },
      data: { email: fixture.users.ownerA.email, password: fixture.password },
    });
    expect(wrong.status()).toBe(401);
  } finally {
    await tenant.close();
  }
});

test('local operator reads metadata only and active company usage agrees with SQL', async ({ page }) => {
  test.setTimeout(60_000);
  // Inactive synthetic records must not inflate active counts.
  await sql(`INSERT INTO "Manager" (name,email,password,role,"isActive","companyId","updatedAt")
    SELECT 'Inactive platform count fixture','inactive-manager-count@example.invalid',password,'MANAGER',false,"companyId",NOW()
    FROM "Manager" WHERE id=$1`, [fixture.users.ownerA.id]);
  await sql(`INSERT INTO "Staff" (name,email,password,"isActive","companyId","updatedAt")
    SELECT 'Inactive platform count fixture','inactive-staff-count@example.invalid',password,false,"companyId",NOW()
    FROM "Staff" WHERE id=$1`, [fixture.staff.transfer.id]);
  await sql(`INSERT INTO "Location" (name,address,latitude,longitude,"isActive","companyId","updatedAt")
    VALUES ('Inactive platform count fixture','Synthetic','31','74',false,$1,NOW())`, [fixture.company.A]);

  const owner = operatorCredentials();
  const signedIn = await page.request.post(backend + '/api/platform/session/login', {
    headers: { Origin: web }, data: owner,
  });
  expect(signedIn.status()).toBe(200);
  const companies = await page.request.get(backend + '/api/platform/companies');
  expect(companies.status()).toBe(200);
  const metadata = await companies.json();
  expect(JSON.stringify(metadata)).not.toContain(owner.password);
  expect(metadata.data.items.every((item: Record<string, unknown>) => !('staff' in item) && !('password' in item))).toBe(true);

  for (const item of metadata.data.items) {
    const [expected] = await sql(`SELECT
      (SELECT COUNT(*)::int FROM "Manager" WHERE "companyId"=$1 AND "isActive" AND role='MANAGER') AS managers,
      (SELECT COUNT(*)::int FROM "Staff" WHERE "companyId"=$1 AND "isActive") AS staff,
      (SELECT COUNT(*)::int FROM "Location" WHERE "companyId"=$1 AND "isActive") AS locations`, [item.id]);
    expect(item.counts).toEqual(expected);
  }
  const company = metadata.data.items.find((item: { id: number }) => item.id === fixture.company.A);
  expect(company.counts.managers).toBeGreaterThan(0);
  expect(company.counts.staff).toBeGreaterThan(0);

  await page.goto('/platform/companies/' + fixture.company.A);
  await expect(page.getByRole('heading', { name: 'E2E company A', level: 1 })).toBeVisible();
  const usage = page.getByRole('region', { name: 'Usage against plan' });
  for (const [key, label] of [['managers', 'Managers'], ['staff', 'Staff'], ['locations', 'Locations']]) {
    await expect(usage.getByRole('meter', { name: label })).toHaveAttribute('aria-valuetext', new RegExp('^' + company.counts[key] + ' / \\d+$'));
  }

  await page.goto('/platform/companies');
  await expect(page.getByRole('heading', { name: 'Companies', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open E2E company A', exact: true })).toBeVisible();
  const out = fileURLToPath(new URL('./.artifacts/evidence/local-platform-evidence/', import.meta.url));
  await mkdir(out, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: join(out, 'companies-1280-en.png'), animations: 'disabled', fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  await page.screenshot({ path: join(out, 'companies-390-en.png'), animations: 'disabled', fullPage: true });
});
