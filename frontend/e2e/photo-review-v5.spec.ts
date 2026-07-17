import { ui, choose } from './workspace-helpers';
import {test,expect,fixture,enter,backend,sql} from './fixtures';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=join(root,'frontend/e2e/.artifacts/evidence/v5-review-evidence');
test.use({trace:'off',screenshot:'off',video:'off'});
test('V5 review workspace rendered against approved references in English and Urdu',async({browser})=>{
 test.setTimeout(180000);await mkdir(out,{recursive:true});const results:unknown[]=[];
 for(const width of [1366,390,1920]) for(const lang of ['en','ur']) {
  const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await enter(page,'/exceptions','ownerA',lang);
  await expect(page.getByRole('link', {name:/E2E review room/})).toBeVisible();
  if(width>650)await expect(page.getByRole('region', { name: ui('Review photo') })).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:join(out,`app-queue-${width}-${lang}.png`),fullPage:true});
  await page.getByRole('link', {name:/E2E review room/}).click();
  await expect(page.getByRole('region', { name: ui('Your decision') })).toBeVisible();
  await expect(page.getByRole('region', { name: ui('Review photo') })).toBeVisible();
  await expect(page.getByRole('region', { name: ui('Task and evidence status') })).toBeVisible();
  await page.screenshot({path:join(out,`app-detail-${width}-${lang}.png`),fullPage:true});
  if(width<1700){const evidence=await page.getByRole('region', { name: ui('Review photo') }).boundingBox();const decision=await page.getByRole('region', { name: ui('Your decision') }).boundingBox();expect(decision!.y).toBeGreaterThan(evidence!.y+evidence!.height);}
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  results.push({width,lang,overflow,errors:[...errors]});expect(overflow).toBe(false);expect(errors).toEqual([]);
  await expect(page.getByRole('region', {name: ui('Review queue')})).toBeVisible();
  await context.close();
 }
 await writeFile(join(out,'render-results.json'),JSON.stringify(results,null,2));
});
test('V5 review filters use scoped API data, empty states and authorization',async({page})=>{
 await enter(page,'/exceptions');await expect(page.getByRole('link', {name:/E2E review room/})).toBeVisible();
 await page.getByRole('button',{name:/^Inspect /}).first().click();
 await expect(page.getByRole('article', { name: /E2E sink/ })).toBeFocused();
 await page.getByRole('button', { name:'Review filters', exact:true }).click();
 await choose(page, 'Review reason', 'Required photo is missing');
 await expect(page).toHaveURL(/reasonCode=MISSING_EVIDENCE/);
 await expect(page.getByRole('link', {name:/E2E review room/})).toBeVisible();
 await choose(page, 'Review reason', 'Photo needs a privacy check');
 await expect(page.getByRole('heading',{name:'No matching reviews'})).toBeVisible();
 await page.screenshot({path:join(out,'app-filter-empty-1366-en.png'),fullPage:true});
 await page.goto(`/exceptions?locationId=${fixture.site.foreign}`);
 await expect(page.getByRole('alert').first()).toContainText('You do not have access');
 await expect(page.getByRole('link', {name:/E2E review room/})).toHaveCount(0);
 await page.screenshot({path:join(out,'app-site-denied-1366-en.png'),fullPage:true});
 const response=await page.request.get(backend+`/api/verification-exceptions?queue=needs-me&reasonCode=MISSING_EVIDENCE&locationId=${fixture.site.foreign}`);expect(response.status()).toBe(403);
});
test('V5 real concurrent review keeps its note and requires refreshed data',async({page})=>{
 await enter(page,`/exceptions/${fixture.review.id}`);
 await page.getByRole('textbox',{name:'Resolution note',exact:true}).fill('Synthetic draft kept across concurrent reviewer change');
 await sql('UPDATE "VerificationException" SET "rowVersion"="rowVersion"+1 WHERE id=$1',[fixture.review.id]);
 await page.getByRole('button',{name:'Confirm resolution',exact:true}).click();
 await expect(page.getByText('This review changed. Refresh before saving. Your note is kept.')).toBeVisible();
 await expect(page.getByRole('button',{name:'Confirm resolution',exact:true})).toBeDisabled();
 await page.screenshot({path:join(out,'app-real-conflict-1366-en.png'),fullPage:true});
 await page.getByRole('button',{name:'Refresh review',exact:true}).click();
 await expect(page.getByRole('button',{name:'Confirm resolution',exact:true})).toBeEnabled();
 await expect(page.getByRole('textbox',{name:'Resolution note',exact:true})).toHaveValue('Synthetic draft kept across concurrent reviewer change');
});
// Explicit HTTP presentation seam: the DB contains no retained photo. These
// images/metadata are synthetic fixtures, never evidence of a live media provider.
test('V5 protected viewer presentation fixture supports zoom, enlargement and image errors',async({browser})=>{
 test.setTimeout(120000);await mkdir(out,{recursive:true});
 for(const width of [1366,390]) for(const lang of ['en','ur']) {
  const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();
  await page.route(`**/api/verification-exceptions/${fixture.review.id}`,async route=>{
   const response=await route.fetch();const body=await response.json();const requirement=body.data.items[0].requirements[0];
   const attempt={id:'synthetic-viewer-attempt',state:'REVIEW_REQUIRED',mediaAssetId:'synthetic-viewer-media',privacyState:'SAFE',receivedAt:'2026-10-20T05:12:00Z',createdAt:'2026-10-20T05:12:00Z',reviewSummary:{reasonCode:'SERVICE_FAILURE',cleanliness:null,dirtySurfaces:[],missingSurfaces:[]}};
   requirement.state='REVIEW_REQUIRED';requirement.currentAttemptId=attempt.id;requirement.currentAttempt=attempt;
   body.data.issues[0].latestAttempt=attempt;body.data.issues[0].reasonCode='SERVICE_FAILURE';
   await route.fulfill({response,json:body});
  });
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="#e2e8f0"/><path d="M0 200H800M0 400H800M200 0V600M400 0V600M600 0V600" stroke="#94a3b8" stroke-width="2"/><rect x="140" y="160" width="520" height="280" rx="90" fill="#fff" stroke="#64748b" stroke-width="8"/><circle cx="400" cy="320" r="24" fill="#64748b"/><text x="400" y="550" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#0f172a">SYNTHETIC VIEWER TEST • NO OPERATIONAL EVIDENCE</text></svg>';
  await page.route('**/api/evidence/synthetic-viewer-media/content?*',route=>route.fulfill({status:200,contentType:'image/svg+xml',body:svg}));
  await enter(page,`/exceptions/${fixture.review.id}`,'ownerA',lang);
  await page.getByRole('region', {name:ui('Review photo')}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('region', { name: ui('Photo inspection area') }).getByRole('img')).toBeVisible();
  await expect.poll(()=>page.getByRole('region', { name: ui('Photo inspection area') }).getByRole('img').evaluate((element:HTMLImageElement)=>element.complete&&element.naturalWidth>0)).toBe(true);
  await page.getByRole('region', { name: ui('Required photo views') }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('region', { name: ui('Required photo views') }).getByRole('img')).toBeVisible();
  await expect.poll(()=>page.getByRole('region', { name: ui('Required photo views') }).getByRole('img').evaluate((element:HTMLImageElement)=>element.complete&&element.naturalWidth>0)).toBe(true);
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:join(out,`http-fixture-image-${width}-${lang}.png`),fullPage:true});
  await page.getByRole('region', { name: ui('Review photo') }).getByRole('button').nth(1).click();await expect(page.getByLabel(ui('Photo zoom'))).toHaveText('150%');
  await page.getByRole('region', { name: ui('Review photo') }).getByRole('button').last().click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog).toHaveCSS('opacity','1');
  const box=await dialog.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(-1);expect(box!.x+box!.width).toBeLessThanOrEqual(width+1);
  await page.screenshot({path:join(out,`http-fixture-enlarged-${width}-${lang}.png`),animations:'disabled'});await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await page.unroute('**/api/evidence/synthetic-viewer-media/content?*');
  await page.route('**/api/evidence/synthetic-viewer-media/content?*',route=>route.fulfill({status:503,json:{message:'Synthetic media outage'}}));
  await page.reload();await page.getByRole('region', { name: ui('Review photo') }).scrollIntoViewIfNeeded();await expect(page.getByRole('region', { name: ui('Review photo') }).getByRole('alert')).toBeVisible();
  await page.screenshot({path:join(out,`http-fixture-image-error-${width}-${lang}.png`),fullPage:true});
  await page.unroute('**/api/evidence/synthetic-viewer-media/content?*');
  await page.route('**/api/evidence/synthetic-viewer-media/content?*',route=>route.fulfill({status:200,contentType:'image/svg+xml',body:svg}));
  await page.getByRole('region', { name: ui('Review photo') }).getByRole('button', { name: ui('Retry') }).click();
  await page.getByRole('region', {name:ui('Review photo')}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('region', { name: ui('Photo inspection area') }).getByRole('img')).toBeVisible();
  await context.close();
 }
});
