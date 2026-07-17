import {test,expect,backend,enter,fixture,login,sql} from './fixtures';
import type {Page} from '@playwright/test';
test.use({trace:'off',screenshot:'off',video:'off'});
async function lifecycle(page:Page){const response=await page.request.get(backend+'/api/subscription/manage/lifecycle');expect(response.status()).toBe(200);return(await response.json()).data;}
test('F18 F19 F20 persisted subscriber facts and true capacity match SQL in EN UR',async({page})=>{
 for(const lang of ['en','ur']){
  await enter(page,'/subscription','ownerA',lang);await expect(page.getByRole('heading',{name:lang==='en'?'Plan & billing':'پلان اور بلنگ',exact:true})).toBeVisible();const data=await lifecycle(page);
  const [actual]=await sql('SELECT (SELECT COUNT(*)::int FROM "Location" WHERE "companyId"=$1 AND "isActive") AS locations,(SELECT COUNT(*)::int FROM "Staff" WHERE "companyId"=$1 AND "isActive") AS staff,(SELECT COUNT(*)::int FROM "Manager" WHERE "companyId"=$1 AND "isActive") AS managers',[fixture.company.A]);expect(data.usage).toEqual(actual);
  for(const key of ['locations','staff','managers'])await expect(page.getByText(`${data.usage[key]} / ${data.limits[key]}`,{exact:true})).toBeVisible();
  await expect(page.getByRole('navigation',{name:lang==='en'?'Workspace setup':'ورک اسپیس کی تیاری'})).toHaveCount(0);await expect(page.getByRole('button',{name:/checkout/i})).toHaveCount(0);await expect(page.getByRole('link',{name:/help|contact/i})).toHaveCount(0);await page.reload();await expect(page.getByText(`${data.usage.staff} / ${data.limits.staff}`,{exact:true})).toBeVisible();
 }
});
test('F18 F20 retained provider status and absent period do not invent renewal or price',async({page})=>{
 await login(page.request);const[saved]=await sql('SELECT s.* FROM "PaddleSubscription" s JOIN "Company" c ON c."billingSubscriptionId"=s.id WHERE c.id=$1',[fixture.company.A]);
 try{for(const[status,label]of[['past_due','Past due'],['paused','Paused'],['canceled','Canceled'],['trialing','Trialing']]){await sql('UPDATE "PaddleSubscription" SET status=$2,"currentBillingPeriodStart"=NULL,"currentBillingPeriodEnd"=NULL WHERE id=$1',[saved.id,status]);await page.goto('/subscription');await expect(page.getByText(label,{exact:true})).toBeVisible();await expect(page.getByText('Provider price unavailable',{exact:true})).toBeVisible();await expect(page.getByText('Not available',{exact:true}).first()).toBeVisible();expect((await lifecycle(page)).workspaceAccessAllowed).toBe(false);}
 }finally{await sql('UPDATE "PaddleSubscription" SET status=$2,"currentBillingPeriodStart"=$3,"currentBillingPeriodEnd"=$4 WHERE id=$1',[saved.id,saved.status,saved.currentBillingPeriodStart,saved.currentBillingPeriodEnd]);}
});
test('S42-41 real suspended company keeps access restricted after payment facts',async({page})=>{
 const[saved]=await sql('SELECT "operationalStatus" FROM "Company" WHERE id=$1',[fixture.company.A]);
 try{
  await sql('UPDATE "Company" SET "operationalStatus"=\'SUSPENDED\' WHERE id=$1',[fixture.company.A]);
  await enter(page,'/dashboard');await expect(page.getByRole('heading',{name:'This account is restricted',exact:true})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Workspace navigation'})).toHaveCount(0);
  expect((await page.request.get(backend+'/api/manager/operations/performance?period=7')).status()).toBe(403);
  await page.reload();await expect(page.getByRole('heading',{name:'This account is restricted',exact:true})).toBeVisible();
  expect((await lifecycle(page)).workspaceAccessAllowed).toBe(false);
  await page.goto('/account/security');await expect(page.getByLabel('Current password',{exact:true})).toBeVisible();
 }finally{await sql('UPDATE "Company" SET "operationalStatus"=$2 WHERE id=$1',[fixture.company.A,saved.operationalStatus]);}
});
test('F17 legacy inactive status remains blocked',async({page})=>{
 const[saved]=await sql('SELECT "isActive" FROM "Company" WHERE id=$1',[fixture.company.A]);
 try{await enter(page,'/subscription');await sql('UPDATE "Company" SET "isActive"=false WHERE id=$1',[fixture.company.A]);await page.goto('/dashboard');await expect(page.getByRole('heading',{name:'This account is restricted',exact:true})).toBeVisible();await expect(page.getByRole('navigation',{name:'Workspace navigation'})).toHaveCount(0);}
 finally{await sql('UPDATE "Company" SET "isActive"=$2 WHERE id=$1',[fixture.company.A,saved.isActive]);}
});
test('F22 real manager API denies tenant billing injection',async({page})=>{await enter(page,'/dashboard','managerA');for(const path of ['/subscription/manage/lifecycle','/subscription/manage/catalog'])expect((await page.request.get(backend+'/api'+path+'?companyId='+fixture.company.B)).status()).toBe(403);expect((await page.request.post(backend+'/api/subscription/manage/checkout',{data:{companyId:fixture.company.B,plan:'PRO',interval:'month'}})).status()).toBe(403);});
test('F24 forced password change supersedes owner billing',async({page})=>{await login(page.request);await sql('UPDATE "Manager" SET "mustChangePassword"=true WHERE id=$1',[fixture.users.ownerA.id]);try{await page.goto('/subscription/payment?plan=PRO&interval=year');await expect(page.getByLabel('Current password',{exact:true})).toBeVisible();await expect(page.getByTitle('Controlled Paddle card form')).toHaveCount(0);}finally{await sql('UPDATE "Manager" SET "mustChangePassword"=false WHERE id=$1',[fixture.users.ownerA.id]);}});
test('F15 real request failure offers refresh without operational chrome',async({page})=>{await page.route('**/api/subscription/manage/lifecycle',r=>r.abort('failed'));await enter(page,'/dashboard');await expect(page.getByRole('heading',{name:'Workspace access could not be checked'})).toBeVisible();await page.unroute('**/api/subscription/manage/lifecycle');await page.getByRole('button',{name:'Try again',exact:true}).click();await expect(page.getByRole('navigation',{name:'Workspace navigation'})).toBeVisible();});

for(const status of ['past_due','canceled'])test(`S42-43 ${status} retains operational read access and billing page`,async({page})=>{
 await login(page.request);const[saved]=await sql('SELECT s.* FROM "PaddleSubscription" s JOIN "Company" c ON c."billingSubscriptionId"=s.id WHERE c.id=$1',[fixture.company.A]);
 try{
  await sql('UPDATE "PaddleSubscription" SET status=$2,"currentBillingPeriodEnd"=NOW()-interval \'1 day\' WHERE id=$1',[saved.id,status]);
  await page.goto('/subscription');await expect(page.getByRole('heading',{name:'Plan & billing',exact:true})).toBeVisible();
  expect((await page.request.get(backend+'/api/location/')).status()).toBe(200);
  await page.reload();await expect(page.getByRole('heading',{name:'Plan & billing',exact:true})).toBeVisible();
  expect((await lifecycle(page)).workspaceAccessAllowed).toBe(false);
 }finally{await sql('UPDATE "PaddleSubscription" SET status=$2,"currentBillingPeriodEnd"=$3 WHERE id=$1',[saved.id,saved.status,saved.currentBillingPeriodEnd]);}
});
test('S42-55 existing trialing subscriber retains dashboard access after reload',async({page})=>{
 await login(page.request);const[saved]=await sql('SELECT s.* FROM "PaddleSubscription" s JOIN "Company" c ON c."billingSubscriptionId"=s.id WHERE c.id=$1',[fixture.company.A]);
 try{
  await sql('UPDATE "PaddleSubscription" SET status=\'trialing\' WHERE id=$1',[saved.id]);await page.goto('/dashboard');
  await expect(page.getByRole('navigation',{name:'Workspace navigation'})).toBeVisible();await page.reload();
  await expect(page.getByRole('navigation',{name:'Workspace navigation'})).toBeVisible();expect((await lifecycle(page)).workspaceAccessAllowed).toBe(true);
 }finally{await sql('UPDATE "PaddleSubscription" SET status=$2 WHERE id=$1',[saved.id,saved.status]);}
});
