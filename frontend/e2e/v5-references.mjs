import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
// Offline approved references only. This script never contacts an application/API.
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=join(root,'docs/implementation/v5-evidence');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.HYGENE_E2E_BROWSER_PATH || '/usr/bin/google-chrome',args:['--no-sandbox']});
try {
 for(const width of [1366,390]) for(const lang of ['en','ur']) {
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.goto('file://'+join(root,'design/v5/manager.html')+'?lang='+lang);
  await page.locator('[data-task]').first().click();
  await page.locator('#task-dialog[open]').waitFor();
  await page.screenshot({path:join(out,`v5-today-drawer-${width}-${lang}.png`)});
  await page.close();
 }
} finally { await browser.close(); }
