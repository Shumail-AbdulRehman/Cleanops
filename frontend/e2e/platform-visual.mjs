/**
 * Spec40 named-workspace visual checks. Synthetic transport proves presentation
 * and local state handling, NOT authenticated routes, SQL persistence or IdP/MFA.
 * Run serially: node frontend/e2e/platform-visual.mjs [--source /checkout] [--out /evidence]
 */
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPlatformFixture, inquiryId } from './platform-visual-fixture.mjs';

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const root = resolve(option('--source') ?? fileURLToPath(new URL('../../', import.meta.url)));
const out = resolve(option('--out') ?? join(root, 'docs/implementation/v5-platform-evidence'));
// The installed Babel compiler resolves its plugin from the process cwd.
process.chdir(join(root, 'frontend'));
const mode = option('--mode') ?? 'all';
const runtime = await mkdtemp(join(tmpdir(), 'hygene-platform-visual-'));
await mkdir(out, { recursive: true });
const { translate } = await import(pathToFileURL(join(root, 'frontend/src/i18n/translations.ts')).href);
const label = (text, language) => translate(text, language);
const fixture = createPlatformFixture();
const results = [], files = [];
let origin, server, browser;

async function readBody(request) {
  let body = '';
  for await (const chunk of request) { body += chunk; if (body.length > 65536) throw new Error('Fixture request too large'); }
  return body ? JSON.parse(body) : {};
}
const plugin = {
  name: 'isolated-platform-named-component-fixture', enforce: 'pre',
  transform(code, id) {
    if (!id.split('?')[0].endsWith('/src/pages/Platform/operatorSession.ts')) return;
    const marker = 'void _path;';
    if (!code.includes(marker)) throw new Error('Operator request seam changed; review the fixture transform');
    return code.replace(marker, `
      if ((globalThis as unknown as { __platformVisualFixture?: boolean }).__platformVisualFixture === true) {
        const result = await fetch('/__platform_visual/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: _path, options: { method: _options?.method, body: _options?.body } }), signal: _options?.signal });
        const body = await result.json();
        if (!result.ok) throw { response: { status: result.status }, message: 'Synthetic network fixture failure' };
        return body as T;
      }
      ${marker}`);
  },
  configureServer(vite) {
    vite.middlewares.use((request, response, next) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (!url.pathname.startsWith('/__platform_visual') && !url.pathname.startsWith('/api/')) return next();
      void (async () => {
        if (url.pathname === '/__platform_visual') {
          const html = await vite.transformIndexHtml(request.url, '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/platform-visual-entry.tsx"></script></body></html>');
          response.setHeader('content-type', 'text/html'); response.end(html); return;
        }
        response.setHeader('content-type', 'application/json');
        response.setHeader('cache-control', 'no-store');
        if (url.pathname.startsWith('/api/')) { response.statusCode = 500; response.end('{"message":"Unexpected API I/O in isolated UI check"}'); return; }
        if (url.pathname === '/__platform_visual/reset') { fixture.reset((await readBody(request)).scenario); response.end('{}'); return; }
        if (url.pathname === '/__platform_visual/control') { fixture.control(await readBody(request)); response.end('{}'); return; }
        if (url.pathname === '/__platform_visual/inspect') { response.end(JSON.stringify(fixture.inspect())); return; }
        if (url.pathname === '/__platform_visual/request') {
          const { path, options } = await readBody(request);
          const result = await fixture.request(path, options);
          response.statusCode = result.status; response.end(JSON.stringify(result.body)); return;
        }
        response.statusCode = 404; response.end('{}');
      })().catch(error => { response.statusCode = 500; response.end(JSON.stringify({ message: error.message })); });
    });
  },
};

async function control(value) { const response = await fetch(origin + '/__platform_visual/control', { method: 'POST', body: JSON.stringify(value) }); expect(response.ok).toBe(true); }
async function reset(scenario = 'ready') { const response = await fetch(origin + '/__platform_visual/reset', { method: 'POST', body: JSON.stringify({ scenario }) }); expect(response.ok).toBe(true); }
async function inspect() { return (await fetch(origin + '/__platform_visual/inspect')).json(); }
async function createPage(width, language) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'UTC', reducedMotion: 'reduce' });
  await context.addInitScript(language => localStorage.setItem('hygene-ops.language', language), language);
  const page = await context.newPage();
  const issues = { errors: [], apiRequests: [], remoteRequests: [] };
  page.on('pageerror', error => issues.errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) issues.apiRequests.push(url.pathname);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol !== 'file:' && url.protocol !== 'data:') issues.remoteRequests.push(url.origin + url.pathname);
  });
  return { context, page, issues };
}
async function open(page, path, scenario = 'ready') {
  await reset(scenario);
  await page.goto(origin + '/__platform_visual?' + new URLSearchParams({ path }));
  await expect(page.locator('.platform-company-workspace, .platform-service-workspace')).toBeVisible();
}
async function ready(page, kind) {
  if (kind === 'company-list') await expect(page.getByRole('link', { name: 'Synthetic Facilities', exact: true }).first()).toBeVisible();
  else if (kind.startsWith('company')) await expect(page.getByRole('button', { name: /Suspend company|کمپنی معطل کریں|Reactivate company|کمپنی دوبارہ فعال کریں/ })).toBeVisible();
  else if (kind === 'service-diagnostics') await expect(page.getByText(/Reachable at observation|مشاہدے کے وقت/).first()).toBeVisible();
  else if (kind === 'service-audit') {
    await expect(page.getByText(/Company suspended|کمپنی معطل/).filter({ visible: true }).first()).toBeVisible();
    const details = page.locator('.record-summary details:visible').first();
    if (await details.count()) await details.locator('summary').click();
    await expect(page.locator('time:visible').first()).toBeVisible();
  }
  else if (kind === 'service-inquiries') await expect(page.getByRole('link', { name: 'Synthetic Prospect', exact: true }).first()).toBeVisible();
  else await expect(page.locator('form.platform-service-edit')).toBeVisible();
}
async function capture(page, name, width, language, issues, provenance = 'named real React workspace; synthetic operatorRequest response store') {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.locator('html').getAttribute('dir')).toBe(language === 'ur' ? 'rtl' : 'ltr');
  const checks = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    buttonTargets: [...document.querySelectorAll('button')].filter(button => button.getBoundingClientRect().width && button.getBoundingClientRect().height).map(button => ({ text: button.textContent?.trim() || button.getAttribute('aria-label'), width: Math.round(button.getBoundingClientRect().width), height: Math.round(button.getBoundingClientRect().height), close: button.getAttribute('data-slot') === 'dialog-close' })),
    h1: [...document.querySelectorAll('h1')].map(item => item.textContent), scrollY,
  }));
  expect(checks.overflow, name + ' page overflow').toBe(false);
  expect(issues.errors, name + ' JavaScript errors').toEqual([]);
  expect(issues.apiRequests, name + ' unexpected real API request').toEqual([]);
  expect(issues.remoteRequests, name + ' unexpected external request').toEqual([]);
  const undersized = checks.buttonTargets.filter(button => !button.close && button.height < (width < 620 ? 48 : 44));
  expect(undersized, name + ' undersized action buttons').toEqual([]);
  const file = `app-${name}-${width}-${language}.png`;
  await page.screenshot({ path: join(out, file), animations: 'disabled' });
  files.push(file);
  results.push({ name, width, height: 900, language, provenance, ...checks, ...issues, requests: (await inspect()).requests });
}
async function reference(context, file, name, width, language, tab) {
  const page = await context.newPage();
  await page.goto(pathToFileURL(join(root, 'design/v5', file + '.html')).href + '?' + new URLSearchParams({ lang: language, ...(tab ? { tab } : {}) }));
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const target = `v5-${name}-${width}-${language}.png`;
  await page.screenshot({ path: join(out, target), animations: 'disabled' });
  files.push(target); await page.close();
}

const core = [
  { name: 'company-list', path: '/platform/companies', reference: 'platform' },
  { name: 'company-account', path: '/platform/companies/42', reference: 'customer' },
  { name: 'company-billing', path: '/platform/companies/42', reference: 'customer', tab: 'billing', button: 'Billing' },
  { name: 'company-activity', path: '/platform/companies/42', reference: 'customer', tab: 'activity', button: 'Activity' },
  { name: 'service-diagnostics', path: '/platform/service', reference: 'service' },
  { name: 'service-audit', path: '/platform/audit', reference: 'audit' },
  { name: 'service-inquiries', path: '/platform/inquiries', reference: 'leads' },
  { name: 'service-handling', path: `/platform/inquiries?inquiry=${inquiryId}`, reference: 'leads' },
];
async function runCore() {
  for (const width of [1366, 390]) for (const language of ['en', 'ur']) {
    const { context, page, issues } = await createPage(width, language);
    for (const view of core) {
      await open(page, view.path); await ready(page, view.name);
      if (width === 390 && ['company-list', 'service-diagnostics'].includes(view.name)) {
        const menu = page.getByRole('button', { name: label('Platform navigation', language), exact: true });
        await menu.focus(); await page.keyboard.press('Enter');
        await expect(menu).toHaveAttribute('aria-expanded', 'true');
        await expect(page.getByRole('link', { name: label('Companies', language), exact: true })).toBeVisible();
        await page.keyboard.press('Enter'); await expect(menu).toHaveAttribute('aria-expanded', 'false');
      }
      if (view.button) {
        await page.getByRole('button', { name: label(view.button, language), exact: true }).click();
        await expect(page.getByRole('button', { name: label(view.button, language), exact: true })).toHaveAttribute('aria-pressed', 'true');
      }
      await capture(page, view.name, width, language, issues);
      if (width === 390 && ['company-account', 'service-handling'].includes(view.name)) {
        const full = `app-${view.name}-full-${width}-${language}.png`;
        await page.screenshot({ path: join(out, full), fullPage: true, animations: 'disabled' }); files.push(full);
      }
      await reference(context, view.reference, view.name, width, language, view.tab);
    }
    await context.close();
  }
}
async function runSimpleStates() {
  for (const language of ['en', 'ur']) {
    const { context, page, issues } = await createPage(390, language);
    for (const [kind, path, scenario] of [
      ['company-loading', '/platform/companies', 'loading'], ['company-empty', '/platform/companies', 'empty'], ['company-error', '/platform/companies', 'error'],
      ['service-empty', '/platform/inquiries', 'empty'], ['service-error', '/platform/service', 'error'], ['service-unavailable', '/platform/service', 'unavailable'],
    ]) {
      await open(page, path, scenario);
      if (scenario === 'loading') await expect(page.getByRole('status').first()).toBeVisible();
      else if (scenario === 'error') await expect(page.getByRole('alert').first()).toBeVisible();
      else if (scenario === 'empty') await expect(page.locator('.platform-company-workspace, .platform-service-workspace')).toContainText(language === 'en' ? /No companies|No inquiries/ : /کوئی/);
      else await expect(page.getByText(label('Database unavailable', language), { exact: true })).toBeVisible();
      await capture(page, kind, 390, language, issues);
      if (scenario === 'loading' || scenario === 'error') {
        await control({ ready: true });
        if (scenario === 'error') await page.getByRole('button', { name: label('Retry', language), exact: true }).first().click();
        if (path.includes('companies')) await ready(page, 'company-list');
        else await ready(page, 'service-diagnostics');
      }
    }
    await context.close();
  }
}
async function runMutations() {
  for (const language of ['en', 'ur']) for (const scenario of ['conflict', 'uncertain', 'pending']) for (const kind of ['company', 'inquiry']) {
    const { context, page, issues } = await createPage(390, language);
    const company = kind === 'company';
    await open(page, company ? '/platform/companies/42' : `/platform/inquiries?inquiry=${inquiryId}`, scenario);
    await ready(page, company ? 'company-account' : 'service-handling');
    if (company) await page.getByRole('button', { name: label('Suspend company', language), exact: true }).click();
    else {
      await page.getByLabel(label('Handling status', language), { exact: true }).selectOption('IN_PROGRESS');
      await page.getByLabel(label('Ownership decision', language), { exact: true }).selectOption('SELF');
    }
    const reason = page.getByLabel(label('Reason', language), { exact: true });
    if (company) await expect(reason).toBeFocused();
    await reason.fill('Synthetic reviewed request');
    const submit = page.getByRole('button', { name: label(company ? 'Confirm status change' : 'Save handling', language), exact: true });
    await submit.click();
    if (scenario === 'pending') {
      await expect(reason).toBeDisabled();
      if (company) { await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toBeVisible(); }
      else await expect(page.locator('form.platform-service-edit button[type="submit"]')).toBeDisabled();
      expect((await inspect()).patches).toBe(0);
      await capture(page, `${kind}-pending`, 390, language, issues);
      await control({ ready: true });
    } else {
      await expect(page.getByRole('alert').last()).toBeVisible();
      await expect(reason).toHaveValue('Synthetic reviewed request');
      await expect(submit).toBeDisabled();
      await capture(page, `${kind}-${scenario}`, 390, language, issues);
      const refresh = page.getByRole('button', { name: label(company ? 'Refresh company' : 'Refresh inquiry', language), exact: true });
      await refresh.click();
      if (company) await expect(page.getByRole('heading', { name: label('Confirm suspension', language), exact: true })).toBeVisible();
      await expect(submit).toBeEnabled();
      await submit.click();
    }
    if (company) { await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('button', { name: label('Reactivate company', language), exact: true })).toBeVisible(); }
    else await expect(page.getByRole('status').filter({ hasText: label('Handling saved. No message was sent and contact remains unverified.', language) })).toBeVisible();
    const saved = await inspect();
    expect(saved.changes, `${kind} ${scenario} synthetic state changes`).toBe(1);
    await page.reload(); await ready(page, company ? 'company-account' : 'service-handling');
    if (company) await expect(page.getByRole('button', { name: label('Reactivate company', language), exact: true })).toBeVisible();
    else await expect(page.getByText(label('In progress', language), { exact: true }).first()).toBeVisible();
    results.push({ name: `${kind}-${scenario}-synthetic-reload`, width: 390, height: 900, language, provenance: 'in-memory synthetic fixture survives React reload; NOT SQL persistence', changes: saved.changes, patches: saved.patches, requests: saved.requests });
    await context.close();
  }
}
async function runSupportRefresh() {
  for (const language of ['en', 'ur']) {
    const { context, page, issues } = await createPage(390, language);
    await open(page, '/platform/service', 'support'); await ready(page, 'service-diagnostics');
    await expect(page.locator('a[href^="mailto:"]')).toHaveCount(1);
    await control({ supportFailure: true });
    await page.getByRole('button', { name: label('Refresh support contact', language), exact: true }).click();
    await expect(page.getByText(label('Support contact could not be loaded.', language), { exact: true })).toBeVisible();
    await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
    await capture(page, 'service-support-refresh-error', 390, language, issues);
    await control({ supportFailure: false });
    await page.getByRole('button', { name: label('Retry support contact', language), exact: true }).click();
    await expect(page.locator('a[href^="mailto:"]')).toHaveCount(1);
    await context.close();
  }
}
async function runGuard() {
  for (const width of [1366, 390]) for (const language of ['en', 'ur']) {
    const { context, page, issues } = await createPage(width, language);
    await page.addInitScript(() => localStorage.setItem('operator', JSON.stringify({ role: 'ADMIN', kind: 'PLATFORM_OPERATOR', token: 'untrusted-synthetic-claim' })));
    await reset();
    for (const path of ['/platform/companies', '/platform/companies/42', '/platform/service', '/platform/audit', '/platform/inquiries']) {
      await page.goto(origin + path);
      await expect(page.locator('.operator-access h1')).toBeVisible();
      await expect(page.locator('.operator-provider-state button')).toBeDisabled();
      await expect(page.locator('.platform-company-workspace, .platform-service-workspace')).toHaveCount(0);
      expect(await page.evaluate(() => window.__platformVisualFixture)).toBeUndefined();
      expect((await inspect()).requests).toEqual([]);
    }
    await capture(page, 'guarded-route', width, language, issues, 'actual default React router and unmodified fail-closed operator boundary; no fixture transport invoked');
    await context.close();
  }
}
try {
  server = await createServer({ configFile: join(root, 'frontend/vite.config.ts'), root: join(root, 'frontend'), envDir: runtime, logLevel: 'warn', plugins: [plugin], server: { host: '127.0.0.1', port: 0, strictPort: false, proxy: {}, fs: { allow: [root, await realpath(join(root, 'frontend/node_modules'))] } } });
  await server.listen(); origin = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ executablePath: process.env.HYGENE_E2E_BROWSER_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  if (['all', 'core'].includes(mode)) await runCore();
  if (['all', 'states'].includes(mode)) { await runSimpleStates(); await runMutations(); await runSupportRefresh(); }
  if (['all', 'guard'].includes(mode)) await runGuard();
  const source = {};
  for (const name of ['CompaniesPage.tsx', 'companies.css', 'ServicePage.tsx', 'service.css', 'operatorSession.ts', 'OperatorLogin.tsx']) source[name] = createHash('sha256').update(await readFile(join(root, 'frontend/src/pages/Platform', name))).digest('hex');
  const manifest = { sourceRoot: root, revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), source, provenance: 'real named React components, test-only synthetic operatorRequest response store; no live provider/auth/SQL qualification', viewportHeights: 900, mode, observations: results.length, files: [] };
  for (const name of files) { const content = await readFile(join(out, name)); manifest.files.push({ name, sha256: createHash('sha256').update(content).digest('hex'), width: content.readUInt32BE(16), height: content.readUInt32BE(20) }); }
  await writeFile(join(out, `${mode}-results.json`), JSON.stringify(results, null, 2));
  await writeFile(join(out, `${mode}-manifest.json`), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ passed: results.length, screenshots: files.length, sourceRoot: root, mode, evidence: out }));
} catch (error) {
  await writeFile(join(out, `${mode}-failure.json`), JSON.stringify({ message: error.stack, completed: results }, null, 2));
  if (browser) for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) {
    await page.screenshot({ path: join(out, `${mode}-failure-${index}.png`), fullPage: true }).catch(() => {});
  }
  throw error;
} finally { if (browser) await browser.close(); if (server) await server.close(); await rm(runtime, { recursive: true, force: true }); }
