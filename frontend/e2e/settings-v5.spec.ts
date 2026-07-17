import { ui } from './workspace-helpers';
import {test,expect,enter,fixture,sql,backend} from './fixtures';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=join(root,'frontend/e2e/.artifacts/evidence/v5-settings-evidence');
// Explicit evidence contains synthetic profile facts and empty credential fields.
// Do not persist traces, video, auth state or credential-bearing failure captures.
test.use({trace:'off',screenshot:'off',video:'off'});
test('V5 settings organization account and security render desktop phone English Urdu',async({browser})=>{
 test.setTimeout(120000);await mkdir(out,{recursive:true});const results:unknown[]=[];
 for(const width of [1366,390])for(const lang of ['en','ur']){
  const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  for(const section of ['organization','account','security']){
   await enter(page,`/settings${section==='organization'?'':'?section='+section}`,'ownerA',lang);
   await expect(page.getByRole('heading', { name: ui('Settings'), level: 1 })).toBeVisible();
   if(section==='organization')await expect(page.getByLabel(ui('Company name'), {exact:true})).toBeVisible();
   if(section==='account')await expect(page.getByRole('region', { name: ui('My account') })).toBeVisible();
   if(section==='security')await expect(page.getByLabel(ui('New password'), {exact:true})).toBeVisible();
   await expect(page.getByRole('main').getByRole('status')).toHaveCount(0);await page.evaluate(()=>document.fonts.ready);
   await page.screenshot({path:join(out,`app-${section}-${width}-${lang}.png`),fullPage:true});
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);expect(overflow).toBe(false);expect(errors).toEqual([]);
   results.push({section,width,lang,overflow,errors:[...errors],route:`/settings${section==='organization'?'':'?section='+section}`});
  }
  await context.close();
 }
 await writeFile(join(out,'render-results.json'),JSON.stringify(results,null,2));
});
test('settings save conflict and explicit refresh use actual persisted company versions',async({page})=>{
 await mkdir(out,{recursive:true});await page.setViewportSize({width:1366,height:900});await enter(page,'/settings');const name=page.getByLabel('Company name',{exact:true});await expect(name).toBeVisible();
 await name.fill('V5 settings persisted company');await page.getByRole('button',{name:'Save company name',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Company settings saved.');
 expect((await sql('SELECT name FROM "Company" WHERE id=$1',[fixture.company.A]))[0].name).toBe('V5 settings persisted company');
 await page.reload();await expect(name).toHaveValue('V5 settings persisted company');
 await page.screenshot({path:join(out,'app-organization-saved-1366-en.png'),fullPage:true});
 await name.fill('V5 conflict draft');await sql('UPDATE "Company" SET name=$2,"accountVersion"="accountVersion"+1 WHERE id=$1',[fixture.company.A,'Concurrent saved company']);
 await page.getByRole('button',{name:'Save company name',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Company settings changed elsewhere');await expect(name).toHaveValue('V5 conflict draft');
 await page.screenshot({path:join(out,'app-organization-conflict-1366-en.png'),fullPage:true});
 await page.getByRole('button',{name:'Reload saved settings',exact:true}).click();await expect(name).toHaveValue('Concurrent saved company');
 await name.fill('V5 company after refresh');await page.getByRole('button',{name:'Save company name',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Company settings saved.');
 expect((await sql('SELECT name FROM "Company" WHERE id=$1',[fixture.company.A]))[0].name).toBe('V5 company after refresh');
});
test('settings loading forwards real request and manager denial keeps own security reachable',async({page})=>{
 await mkdir(out,{recursive:true});await page.setViewportSize({width:390,height:900});
 await page.route('**/api/company/settings',async route=>{if(route.request().method()==='GET')await new Promise(resolve=>setTimeout(resolve,1200));await route.continue();});
 await enter(page,'/settings');await expect(page.getByText('Loading company settings…', {exact:true})).toBeVisible();await page.screenshot({path:join(out,'app-organization-loading-390-en.png'),fullPage:true});await expect(page.getByLabel('Company name',{exact:true})).toBeVisible();await page.unroute('**/api/company/settings');
 await enter(page,'/settings','managerA');expect((await page.request.get(backend+'/api/company/settings')).status()).toBe(403);await expect(page).toHaveURL(/\/dashboard(?:[?#]|$)/);await expect(page.getByLabel(ui('Company name'), {exact:true})).toHaveCount(0);await page.screenshot({path:join(out,'app-manager-settings-redirect-loading-390-en.png'),fullPage:true});
 await page.goto('/account/security');await expect(page.getByLabel('Current password',{exact:true})).toBeVisible();await page.screenshot({path:join(out,'app-manager-own-security-390-en.png'),fullPage:true});
});
test('settings show actual unverified enrollment and labelled network failure with explicit retry',async({browser})=>{
 test.setTimeout(60000);await mkdir(out,{recursive:true});
 const before=await sql('SELECT "emailVerifiedAt" FROM "Manager" WHERE id=$1',[fixture.users.ownerA.id]);
 try{
  // Synthetic fixture mutation tests the real unverified/legacy status. It does
  // not enroll or verify a person, qualify a sender, or send a message.
  await sql('UPDATE "Manager" SET "emailVerifiedAt"=NULL WHERE id=$1',[fixture.users.ownerA.id]);
  for(const lang of ['en','ur']){
   const context=await browser.newContext({viewport:{width:390,height:900}});const page=await context.newPage();
   await enter(page,'/settings?section=account','ownerA',lang);
   await expect(page.getByText(lang==='ur'?'مالک کی ای میل کی تصدیق نہیں ہوئی۔':'Owner email is not verified.',{exact:true})).toBeVisible();
   await expect(page.getByRole('region', { name: ui('My account') }).getByRole('status')).toHaveCount(0);
   await page.screenshot({path:join(out,`app-account-unverified-390-${lang}.png`),fullPage:true});
   // Explicit transport-failure seam: abort GET, never substitute an API response.
   await page.route('**/api/company/settings',route=>route.abort('failed'));
   await page.goto('/settings');await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
   await page.screenshot({path:join(out,`app-organization-network-error-390-${lang}.png`),fullPage:true});
   await page.unroute('**/api/company/settings');await page.getByRole('button',{name:lang==='ur'?'محفوظ ترتیبات دوبارہ کھولیں':'Reload saved settings',exact:true}).click();await expect(page.getByLabel(ui('Company name'), {exact:true})).toBeVisible();
   await page.getByLabel(ui('Company name'), {exact:true}).fill(lang==='ur'?'نیٹ ورک کے دوران مسودہ':'Draft through failed refresh');
   await page.route('**/api/company/settings',route=>route.abort('failed'));await page.getByRole('button',{name:lang==='ur'?'محفوظ ترتیبات دوبارہ کھولیں':'Reload saved settings',exact:true}).click();
   await expect(page.getByRole('main').getByRole('alert')).toBeVisible();await expect(page.getByLabel(ui('Company name'), {exact:true})).toHaveValue(lang==='ur'?'نیٹ ورک کے دوران مسودہ':'Draft through failed refresh');
   await page.screenshot({path:join(out,`app-organization-stale-draft-390-${lang}.png`),fullPage:true});await page.unroute('**/api/company/settings');
   expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);await context.close();
  }
 }finally{await sql('UPDATE "Manager" SET "emailVerifiedAt"=$2 WHERE id=$1',[fixture.users.ownerA.id,before[0].emailVerifiedAt]);}
});
