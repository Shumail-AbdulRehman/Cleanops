/** Spec40 source preview only: RN Web export + synthetic HTTP, never native acceptance. */
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bundle = resolve(process.argv[2]);
const out = join(root, 'docs/implementation/v5-native-source-evidence');
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.otf': 'font/otf', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };
const server = createServer(async (request, response) => {
  try {
    let file = resolve(bundle, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!file.startsWith(bundle + '/') && file !== bundle) { response.writeHead(403).end(); return; }
    if ((await stat(file).catch(() => null))?.isFile() !== true) file = join(bundle, 'index.html');
    response.setHeader('content-type', mime[extname(file)] ?? 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(500).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const results = [];
try {
  for (const language of ['en', 'ur']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 }, timezoneId: 'UTC' });
    const user = { id: 2, companyId: 7, role: 'STAFF', name: 'Synthetic staff', email: 'staff@example.invalid', locationId: 11 };
    await context.addInitScript(({ language, user }) => {
      localStorage.setItem('@cleanops-staff/auth', JSON.stringify({ user, accessToken: 'synthetic-preview-access', refreshToken: 'synthetic-preview-refresh' }));
      localStorage.setItem('hygene-ops.language', language);
    }, { language, user });
    const now = Date.now(), start = new Date(now - 3600000).toISOString(), end = new Date(now + 6 * 3600000).toISOString();
    const task = { id: 51, title: 'Daily clean', areaNameSnapshot: 'Synthetic washroom', status: 'PENDING', verificationVersion: 2, date: start, shiftStart: start, shiftEnd: end, location: { id: 11, name: 'Synthetic site', timezone: 'UTC' } };
    const requests = [], errors = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      // Expo Camera eagerly loads a WEB-ONLY decoder at import time. This preview
      // never opens a camera or tests QR recognition; keep that worker inert and
      // offline rather than allowing an external request to qualify scanning.
      if (url.href === 'https://cdn.jsdelivr.net/npm/jsqr@1.2.0/dist/jsQR.min.js') return route.fulfill({ contentType: 'text/javascript', body: 'self.jsQR = () => null;' });
      if (url.pathname.startsWith('/api/')) {
        requests.push({ path: url.pathname, method: route.request().method() });
        const headers = { 'access-control-allow-origin': origin, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-credentials': 'true' };
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        let data;
        if (url.pathname === '/api/common/get-current-user') data = user;
        else if (url.pathname === '/api/staff/mobile/tasks') data = { tasks: [task], counts: { total: 1, submitted: 0, pending: 1, inProgress: 0 }, nextCursor: null };
        else if (url.pathname === '/api/staff/mobile/attendance') data = [{ id: 41, date: start, status: 'CHECKED_IN', expectedStart: start, expectedEnd: end, checkInTime: start, checkOutTime: null, location: task.location }];
        else if (url.pathname === '/api/task-instance/51') data = task;
        else return route.fulfill({ status: 503, headers, json: { message: 'Unsupported source-preview fixture request' } });
        return route.fulfill({ headers, json: { success: true, data } });
      }
      if (url.origin === origin || url.protocol === 'file:' || url.protocol === 'data:') return route.continue();
      return route.abort();
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await expect(page.getByText(language === 'ur' ? 'آپ کا کام کا دن' : 'Your working day', { exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    for (const screen of ['day', 'tasks', 'start', 'help']) {
      if (screen === 'tasks') await page.getByRole('tab', { name: language === 'ur' ? /کام/ : /Tasks/ }).click();
      if (screen === 'start') {
        await page.getByRole('button', { name: language === 'ur' ? 'صفائی شروع کریں' : 'Start cleaning', exact: true }).click();
        await expect(page.getByText(language === 'ur' ? 'اس کام کا کیو آر اسکین کریں' : 'Scan this task’s QR', { exact: true })).toBeVisible();
      }
      if (screen === 'help') {
        await page.reload();
        await page.getByRole('tab', { name: language === 'ur' ? /مدد/ : /Help/ }).click();
        await expect(page.getByText(language === 'ur' ? 'کام کی اطلاعات' : 'Task alerts', { exact: true })).toBeVisible();
      }
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      expect(overflow).toBe(false); expect(errors).toEqual([]);
      await page.screenshot({ path: join(out, `rnweb-${screen}-390-${language}.png`), animations: 'disabled' });
      results.push({ screen, width: 390, height: 900, language, overflow, errors: [...errors], provenance: 'actual RN Web export; synthetic stored identity/HTTP fixtures; NOT native runtime or device acceptance' });
    }
    expect(requests.filter(row => !['GET', 'OPTIONS'].includes(row.method))).toEqual([]);
    const reference = await context.newPage();
    await reference.goto(pathToFileURL(join(root, 'design/v5/mobile.html')).href + '?lang=' + language);
    await reference.evaluate(() => document.fonts.ready);
    await reference.screenshot({ path: join(out, `v5-mobile-390-${language}.png`), animations: 'disabled' });
    await context.close();
  }
  await writeFile(join(out, 'preview-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ sourcePreviewObservations: results.length, nativeAcceptance: false, output: out }));
} catch (error) {
  for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) {
    await page.screenshot({ path: join(out, `diagnostic-failure-${index}.png`) }).catch(() => {});
  }
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
