import { test, expect, fixture, enter } from './fixtures';
import { copy, noOverflow, taskPanel, ui } from './workspace-helpers';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, 'frontend/e2e/.artifacts/evidence/workspace');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('workspace main screens have no horizontal overflow in English Urdu desktop phone', async ({ browser }) => {
  test.setTimeout(180000); await mkdir(out, { recursive: true });
  const routes = [
    '/dashboard', '/today-status', '/setup', '/exceptions', `/exceptions/${fixture.review.id}`,
    '/attendance', '/locations', `/locations/${fixture.site.A}`, `/locations/${fixture.site.A}?tab=staff`,
    `/locations/${fixture.site.A}?tab=areas`, `/locations/${fixture.site.A}?tab=templates`, `/locations/${fixture.site.A}?tab=instances`,
    `/locations/${fixture.site.A}?tab=schedule`, '/staff', `/staff/${fixture.staff.transfer.id}`,
    `/staff/${fixture.staff.transfer.id}?tab=attendance`, `/staff/${fixture.staff.transfer.id}?tab=instances`,
    `/staff/${fixture.staff.transfer.id}?tab=templates`, '/managers', '/settings', '/settings?section=account', '/settings?section=security',
    '/subscription', `/verification/${fixture.task.photos}`,
  ];
  for (const width of [1366, 390]) for (const language of ['en', 'ur']) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
      await enter(page, routes[0], 'ownerA', language);
      for (const [index, route] of routes.entries()) await test.step(`${width}px ${language} ${route}`, async () => {
        await page.goto(route);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByRole('main').locator('[aria-busy="true"]')).toHaveCount(0);
        await expect(page.getByRole('main').getByRole('status', { name: ui('Loading…') })).toHaveCount(0);
        await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
        await expect(page.locator('html')).toHaveAttribute('dir', language === 'ur' ? 'rtl' : 'ltr');
        await expect(page.locator('html')).toHaveAttribute('lang', new RegExp('^' + language));
        await noOverflow(page); expect(errors).toEqual([]);
        await page.screenshot({ path: join(out, `route-${index}-${width}-${language}.png`), fullPage: true, animations: 'disabled' });
      });
    } finally { await context.close(); }
  }
});

test('Today status filters and task deep links open inline details and Escape restores register', async ({ page }) => {
  await enter(page, '/today-status');
  const filteredRead = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/manager/operations/tasks' && url.searchParams.get('status') === 'in-progress' && response.status() === 200;
  });
  await page.getByRole('navigation', { name: 'Task status', exact: true }).getByRole('link', { name: /^In progress/ }).click();
  await expect(page).toHaveURL(/status=in-progress/);
  const filtered = (await (await filteredRead).json()).data;
  expect(filtered.rows.length).toBeGreaterThan(0);
  expect(filtered.rows.every((row: { status: string }) => row.status === 'IN_PROGRESS')).toBe(true);
  await expect(page.getByRole('region', { name: 'Daily records', exact: true }).getByRole('row', { name: /E2E review room/ })).toBeVisible();
  const filters = page.getByRole('group', { name: 'Task status', exact: true });
  await filters.getByRole('button', { name: /In progress/ }).click(); await expect(page).toHaveURL(/status=in-progress/);
  await filters.getByRole('button', { name: /All tasks/ }).click();
  await page.goto(`/today-status?taskId=${fixture.review.taskId}`);
  const panel = taskPanel(page); await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Task details', exact: true })).toBeFocused();
  await expect(page.getByRole('region', { name: 'Daily records', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0); await expect(page).not.toHaveURL(/taskId=/);
});

test('Today real empty and denied reads, delayed loading and network retry stay explicit', async ({ page }) => {
  await enter(page, '/today-status?q=nonexistent-synthetic-task');
  await expect(page.getByText('No tasks match these filters.', { exact: true })).toBeVisible();
  await page.goto(`/today-status?locationId=${fixture.site.foreign}`);
  await expect(page.getByRole('alert').first()).toContainText('You do not have access');
  await page.route('**/api/manager/operations/**', route => route.abort('failed')); await page.goto('/today-status');
  await expect(page.getByRole('alert').first()).toContainText('This page could not load');
  await page.unroute('**/api/manager/operations/**'); await page.getByRole('button', { name: 'Retry', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Team attendance', exact: true })).toBeVisible();
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/manager/operations/**', async route => { await gate; await route.continue(); });
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('status', { name: ui('Loading…') }).first()).toBeVisible();
  } finally { release(); }
  await expect(page.getByRole('heading', { name: 'Team attendance', exact: true })).toBeVisible();
});
test('V5 public and safe-disabled platform routes have paired evidence without bypassing authorization',async({browser})=>{
 test.setTimeout(180000);
 const routes=[['login','login','/login'],['signup','login','/signup'],['recovery','recovery','/recover-owner-account'],['reset','recovery','/reset-owner-password'],['verify','verify','/verify-owner-email'],['operator-login','operator-login','/platform/login'],['platform','platform','/platform/companies'],['customer','customer','/platform/companies/1'],['operator-security','operator-security','/platform/security'],['service','service','/platform/service'],['audit','audit','/platform/audit'],['leads','leads','/platform/inquiries']];
 for(const width of [1366,390])for(const language of ['en','ur']){
  const context=await browser.newContext({viewport:{width,height:900}});
  const page=await context.newPage();await page.addInitScript(lang=>localStorage.setItem('hygene-ops.language',lang),language);
  for(const [name,prototype,path]of routes){
   await page.goto(path);await page.locator('main').first().waitFor();await page.waitForTimeout(300);await page.evaluate(()=>document.fonts.ready);
   await page.screenshot({path:join(out,`app-${name}-${width}-${language}.png`),fullPage:true});
   const ref=await context.newPage();await ref.goto('file://'+join(root,`design/v5/${prototype}.html`)+`?lang=${language}`);await ref.screenshot({path:join(out,`v5-${name}-${width}-${language}.png`),fullPage:true});await ref.close();
  }
  await enter(page,'/dashboard','transfer',language);
  await expect(page.getByRole('heading',{name:language==='en'?'Your work is in the app':'آپ کا کام ایپ میں ہے'})).toBeVisible();
  await page.screenshot({path:join(out,`app-handoff-${width}-${language}.png`),fullPage:true});
  const ref=await context.newPage();await ref.goto('file://'+join(root,'design/v5/handoff.html')+`?lang=${language}`);await ref.screenshot({path:join(out,`v5-handoff-${width}-${language}.png`),fullPage:true});await context.close();
 }
});


test('Today manager inline panel and phone navigation stay within bounds in English Urdu', async ({ browser }) => {
  test.setTimeout(90000);
  for (const width of [1366, 390]) for (const language of ['en', 'ur']) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      const page = await context.newPage(); await enter(page, `/today-status?taskId=${fixture.review.taskId}`, 'managerA', language);
      const panel = taskPanel(page, language); await expect(panel).toBeVisible();
      await expect(panel.getByRole('heading', { name: 'E2E review room', exact: true })).toBeVisible(); await noOverflow(page);
      await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0);
      if (width === 390) {
        await page.getByRole('button', { name: copy('Open navigation', language), exact: true }).click();
        await expect(page.getByRole('dialog', { name: copy('Workspace menu', language), exact: true })).toBeVisible();
        await noOverflow(page);
      }
    } finally { await context.close(); }
  }
});
