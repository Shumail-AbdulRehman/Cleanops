import { copy } from './workspace-helpers';
import {test,expect,enter,fixture,sql,backend} from './fixtures';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=join(root,'frontend/e2e/.artifacts/evidence/v5-setup-evidence');
test.use({trace:'off',screenshot:'off',video:'off'});
const configured=(site:{counts:{staffWithShift:number;activeAreas:number;readySchedules:number}})=>1+Number(site.counts.staffWithShift>0)+Number(site.counts.activeAreas>0)+Number(site.counts.readySchedules>0);

test('setup actual saved readiness and V5 paired English Urdu desktop phone',async({browser})=>{
 test.setTimeout(120000);await mkdir(out,{recursive:true});const results=[];
 for(const width of [1366,390])for(const lang of ['en','ur']){
  const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await enter(page,'/setup','ownerA',lang);await expect(page.getByRole('button', { name: new RegExp('^' + copy('Setup for location', lang) + ':') })).toContainText('E2E site A');const actualReadiness=(await (await page.request.get(backend+'/api/location/readiness')).json()).data;await expect(page.getByRole('progressbar')).toHaveAttribute('value',String(configured(actualReadiness.sites.find((site:{id:number})=>site.id===fixture.site.A))));await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({animations:'disabled',path:join(out,`app-setup-${width}-${lang}.png`)});await page.screenshot({animations:'disabled',path:join(out,`app-setup-${width}-${lang}-full.png`),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);expect(errors).toEqual([]);results.push({width,lang,errors,source:'actual React/API/disposable SQL; V5 untouched',state:'saved site and active area; unconfigured shift/schedule'});await context.close();
 }
 await writeFile(join(out,'render-results.json'),JSON.stringify(results,null,2));
});
test('setup derives real shift persistence and exact linked forms; managers see only assigned sites',async({page})=>{
 await page.setViewportSize({width:1366,height:900});
 await mkdir(out,{recursive:true});await enter(page,'/setup');await expect(page.getByRole('progressbar')).toBeVisible();
 const previous=await sql('SELECT "shiftStart","shiftEnd" FROM "Staff" WHERE id=$1',[fixture.staff.transfer.id]);
 try{
  await sql('UPDATE "Staff" SET "shiftStart"=$2,"shiftEnd"=$3 WHERE id=$1',[fixture.staff.transfer.id,'2000-01-01T03:00:00Z','2000-01-01T11:00:00Z']);await page.reload();const actualReadiness=(await (await page.request.get(backend+'/api/location/readiness')).json()).data;await expect(page.getByRole('progressbar')).toHaveAttribute('value',String(configured(actualReadiness.sites.find((site:{id:number})=>site.id===fixture.site.A))));
  await expect(page.getByRole('link',{name:'Open team and shifts',exact:true})).toHaveAttribute('href',`/staff?locationId=${fixture.site.A}`);
  await expect(page.getByRole('link',{name:/^(Add cleaning schedule|Review cleaning schedules)$/})).toHaveAttribute('href',new RegExp(`/locations/${fixture.site.A}.*tab=templates`));
  await page.getByRole('link',{name:'Review location',exact:true}).click();await expect(page).toHaveURL(new RegExp('/locations/'+fixture.site.A+'$'));await page.goto('/setup');
  await page.getByRole('link',{name:'Open team and shifts',exact:true}).click();await expect(page).toHaveURL(new RegExp('/staff\\?locationId='+fixture.site.A));await page.goto('/setup');
  await page.getByRole('link',{name:'Add cleaning schedule',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await expect(page).toHaveURL(/tab=templates/);await page.goto('/setup');
  await page.getByRole('link',{name:'Review area templates',exact:true}).click();await expect(page).toHaveURL(/tab=areas/);await page.goto(`/locations/${fixture.site.A}?tab=areas&newArea=1`);await expect(page.getByRole('dialog')).toBeVisible();
 }finally{await sql('UPDATE "Staff" SET "shiftStart"=$2,"shiftEnd"=$3 WHERE id=$1',[fixture.staff.transfer.id,previous[0].shiftStart,previous[0].shiftEnd]);}
 await enter(page,'/setup','managerA');await expect(page.getByRole('button', { name: /^Setup for location:/ })).toContainText('E2E site A');await page.getByRole('button', { name: /^Setup for location:/ }).click();await expect(page.getByRole('menuitemradio')).toHaveCount(1);await expect(page.getByRole('menuitemradio', { name:'E2E site A', exact:true })).toBeVisible();await page.keyboard.press('Escape');expect(await page.getByRole('link',{name:'Plan & billing',exact:true}).count()).toBe(0);
 expect((await page.request.get(backend+'/api/location/readiness?locationId='+fixture.site.foreign)).status()).toBe(404);
 await page.screenshot({animations:'disabled',path:join(out,'app-setup-manager-1366-en.png'),fullPage:true});
});
test('setup loading network error retry and server read-only permission stay truthful',async({page})=>{
 await mkdir(out,{recursive:true});await page.setViewportSize({width:390,height:900});
 await page.route('**/api/location/readiness?*',async route=>{await new Promise(resolve=>setTimeout(resolve,1200));await route.continue();});await enter(page,'/setup');await expect(page.getByText('Loading setup status…', {exact:true})).toBeVisible();await page.screenshot({animations:'disabled',path:join(out,'app-setup-loading-390-en.png'),fullPage:true});await expect(page.getByRole('progressbar')).toBeVisible();await page.unroute('**/api/location/readiness?*');
 await page.route('**/api/location/readiness?*',route=>route.abort('failed'));await page.reload();await expect(page.getByRole('heading',{name:'Setup status could not load'})).toBeVisible();expect(await page.getByRole('progressbar').count()).toBe(0);await page.screenshot({animations:'disabled',path:join(out,'app-setup-network-error-390-en.png'),fullPage:true});await page.unroute('**/api/location/readiness?*');await page.getByRole('button',{name:'Try again',exact:true}).first().click();await expect(page.getByRole('progressbar')).toBeVisible();
 const before=await sql('SELECT s.id,s.status FROM "PaddleSubscription" s JOIN "Company" c ON c."billingSubscriptionId"=s.id WHERE c.id=$1',[fixture.company.A]);
 try{
  await sql('UPDATE "PaddleSubscription" SET status=\'past_due\' WHERE id=$1',[before[0].id]);await page.reload();await expect(page.getByRole('status').filter({hasText:'This workspace is read-only for new work. Review plan activation to add or change setup.'})).toBeVisible();await expect(page.getByRole('link',{name:'Add staff',exact:true})).toHaveCount(0);expect((await page.request.post(backend+`/api/location/${fixture.site.A}/areas`,{data:{name:'Denied read-only area',roomType:'WASHROOM',counts:[]}})).status()).toBe(403);await page.screenshot({animations:'disabled',path:join(out,'app-setup-readonly-390-en.png'),fullPage:true});
 }finally{await sql('UPDATE "PaddleSubscription" SET status=$2 WHERE id=$1',[before[0].id,before[0].status]);}
});
test('setup empty assigned scope and newly persisted owner have honest English Urdu phone states',async({browser})=>{
 test.setTimeout(60000);await mkdir(out,{recursive:true});
 const assignment=await sql('SELECT "locationId","createdAt" FROM "ManagerLocation" WHERE "managerId"=$1',[fixture.users.managerA.id]);
 try{
  await sql('DELETE FROM "ManagerLocation" WHERE "managerId"=$1',[fixture.users.managerA.id]);
  for(const lang of ['en','ur']){
   const context=await browser.newContext({viewport:{width:390,height:900}});const page=await context.newPage();await enter(page,'/setup','managerA',lang);await expect(page.getByRole('heading',{name:lang==='ur'?'ابھی کوئی مقام تفویض نہیں':'No assigned locations yet',exact:true})).toBeVisible();await expect(page.getByRole('progressbar')).toHaveAttribute('value','0');await page.screenshot({animations:'disabled',path:join(out,`app-setup-empty-manager-390-${lang}.png`),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);await context.close();
  }
 }finally{for(const row of assignment)await sql('INSERT INTO "ManagerLocation"("managerId","locationId","createdAt") VALUES($1,$2,$3)',[fixture.users.managerA.id,row.locationId,row.createdAt]);}
 const context=await browser.newContext({viewport:{width:390,height:900}});const page=await context.newPage();
 const signup=await page.request.post(backend+'/api/manager/manager-signup',{data:{name:'Synthetic empty owner',companyName:'Synthetic empty company',email:'setup-empty-owner@example.invalid',password:fixture.password}});expect(signup.status()).toBe(201);
 // This operational empty-state fixture must have a persisted subscription.
 // Unpaid-owner redirection is independently asserted by billing-onboarding.
 const registered=(await signup.json()).data;const customer='ctm_'+'s'.repeat(26),subscription='sub_'+'s'.repeat(26);
 await sql('INSERT INTO "PaddleCustomer"(id,"companyId",status,"paddleUpdatedAt","lastEventAt","updatedAt") VALUES($1,$2,\'active\',NOW(),NOW(),NOW())',[customer,registered.companyId]);
 await sql('INSERT INTO "PaddleSubscription"(id,"companyId","customerId",status,"priceId","productId","currentBillingPeriodStart","currentBillingPeriodEnd","paddleUpdatedAt","lastEventAt","updatedAt") VALUES($1,$2,$3,\'active\',\'pri_00000000000000000000000001\',\'pro_00000000000000000000000001\',NOW()-INTERVAL \'1 day\',NOW()+INTERVAL \'1 day\',NOW(),NOW(),NOW())',[subscription,registered.companyId,customer]);
 await sql('UPDATE "Company" SET "billingCustomerId"=$2,"billingSubscriptionId"=$3,plan=\'STARTER\',"subscriptionStatus"=\'ACTIVE\' WHERE id=$1',[registered.companyId,customer,subscription]);

 for(const lang of ['en','ur']){
  await page.addInitScript(value=>localStorage.setItem('hygene-ops.language',value),lang);await page.goto('/setup');await expect(page.getByRole('heading',{name:lang==='ur'?'ابھی کوئی مقام نہیں':'No locations yet',exact:true})).toBeVisible();await expect(page.getByRole('progressbar')).toHaveAttribute('value','0');await page.screenshot({animations:'disabled',path:join(out,`app-setup-empty-owner-390-${lang}.png`),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 }
 await context.close();
});
