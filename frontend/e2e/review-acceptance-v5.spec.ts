import { ui } from './workspace-helpers';
import {test,expect,fixture,enter,backend,sql,renewSeededStaffCode,verifySeededStaffCode} from './fixtures';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Browser,Page} from '@playwright/test';
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=join(root,'frontend/e2e/.artifacts/evidence/v5-review-acceptance');
const observations:unknown[]=[];
test.use({trace:'off',screenshot:'off',video:'off'});
async function capture(page:Page,name:string,width:number,language:string,provenance:string) {
 await page.evaluate(()=>document.fonts.ready);
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
 expect(overflow).toBe(false);
 await page.screenshot({path:join(out,`${name}-${width}-${language}.png`),fullPage:true});
 if(name==='app-failed-detail-refresh'||name==='app-refreshed-draft')await page.getByRole('region', { name: ui('Your decision') }).screenshot({path:join(out,`${name}-decision-${width}-${language}.png`)});
 observations.push({name,width,height:900,language,overflow,provenance});
 await writeFile(join(out,'observations.json'),JSON.stringify(observations,null,2));
}
async function matrix(browser:Browser,action:(page:Page,width:number,language:string)=>Promise<void>) {
 await mkdir(out,{recursive:true});
 for(const width of [1366,390])for(const language of ['en','ur']) {
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  try {await action(page,width,language);expect(errors).toEqual([]);}finally{await context.close();}
 }
}
test('actual conflict followed by failed detail refresh keeps the draft disabled until recovery',async({browser})=>{
 test.setTimeout(180000);
 await matrix(browser,async(page,width,language)=>{
  await enter(page,`/exceptions/${fixture.review.id}`,'ownerA',language);
  const response=await page.request.get(backend+`/api/verification-exceptions/${fixture.review.id}`);
  const record=(await response.json()).data;
  await sql('UPDATE "VerificationIssue" SET "requirementId"=$1 WHERE id=$2',[record.items[0].requirements[0].id,record.issues[0].id]);
  await page.goto(`/exceptions/${fixture.review.id}?issueId=${record.issues[0].id}`);
  await expect(page.getByRole('region', { name: ui('Task and evidence status') }).getByRole('heading', { name: ui('Photo replacement') })).toContainText(language==='ur'?'متبادل تصویر':'Photo replacement');
  const note=page.getByRole('textbox', { name: ui('Resolution note') });await note.fill('Synthetic Spec36 draft survives failed refresh');
  await sql('UPDATE "VerificationException" SET "rowVersion"="rowVersion"+1 WHERE id=$1',[fixture.review.id]);
  await page.getByRole('button', { name: ui('Confirm resolution') }).click();await expect(page.getByRole('region', { name: ui('Your decision') }).getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: ui('Confirm resolution') })).toBeDisabled();
  await page.route(`**/api/verification-exceptions/${fixture.review.id}`,route=>route.abort());
  await page.getByRole('region', { name: ui('Your decision') }).getByRole('button').filter({hasText:language==='ur'?'جائزہ تازہ کریں':'Refresh review'}).click();
  await expect(page.getByRole('region', { name: ui('Your decision') }).getByRole('alert').first()).toContainText(language==='ur'?'تفصیلات تازہ نہیں ہو سکیں':'Review details could not refresh');
  await expect(note).toHaveValue('Synthetic Spec36 draft survives failed refresh');
  await expect(page.getByRole('button', { name: ui('Confirm resolution') })).toBeDisabled();
  await capture(page,'app-failed-detail-refresh',width,language,'actual API conflict; labelled aborted detail refresh; no positive response replaced');
  await page.unroute(`**/api/verification-exceptions/${fixture.review.id}`);
  await page.getByRole('region', { name: ui('Your decision') }).getByRole('button').filter({hasText:language==='ur'?'جائزہ تازہ کریں':'Refresh review'}).click();
  await expect(page.getByRole('button', { name: ui('Confirm resolution') })).toBeEnabled();await expect(page.getByRole('region', { name: ui('Your decision') }).getByRole('alert')).toHaveCount(0);await expect(note).toHaveValue('Synthetic Spec36 draft survives failed refresh');
  await capture(page,'app-refreshed-draft',width,language,'actual refreshed scoped API and preserved unsaved note');
  // Unmounting intentionally discards this synthetic draft; it is never submitted.
 });
});
test('real persistence rejects public evidence and private review keeps site and role restrictions',async({request})=>{
 const id=randomUUID();
 const insert=`INSERT INTO "EvidenceAsset" (id,"companyId","locationId","taskInstanceId","originalPublicId",format,bytes,width,height,sha256,"privacyState","deliveryType") VALUES ($1,$2,$3,$4,'synthetic-no-original','png',0,1,1,'synthetic-no-bytes','HOLD',$5)`;
 await expect(sql(insert,[id,fixture.company.A,fixture.site.A,fixture.review.taskId,'upload'])).rejects.toMatchObject({code:'23514'});
 await sql(insert,[id,fixture.company.A,fixture.site.A,fixture.review.taskId,'authenticated']);
 const results:unknown[]=[];
 for(const [who,status]of [['managerA',409],['ownerA',409],['managerB',403],['ownerB',404],['recovery',403]] as const){
  if (who === 'recovery') {
   await renewSeededStaffCode(who);
   expect((await verifySeededStaffCode(request, who)).status()).toBe(200);
  } else {
   expect((await request.post(backend+'/api/manager/manager-login',{data:{email:fixture.users[who].email,password:fixture.password}})).status()).toBe(200);
  }
  const response=await request.get(backend+`/api/evidence/${id}/content?variant=review`);expect(response.status()).toBe(status);
  const body=await response.text();expect(body).not.toContain('synthetic-no-original');expect(body).not.toContain('synthetic-no-review');
  expect((await request.get(backend+`/api/evidence/${id}/content?variant=original`)).status()).toBe(who==='ownerB'?404:403);
  results.push({who,status,publicDeliveryConstraint:'23514'});
 }
 await mkdir(out,{recursive:true});await writeFile(join(out,'private-authorization.json'),JSON.stringify(results,null,2));
});
test('review-specific unavailable feedback preserves boundaries in both languages and layouts',async({browser})=>{
 test.setTimeout(120000);
 await matrix(browser,async(page,width,language)=>{
  await enter(page,`/exceptions/${fixture.review.id}`,'managerB',language);
  const detail=page.getByRole('main');await expect(detail.getByRole('alert')).toContainText(language==='ur'?'اس جائزے تک رسائی نہیں':'access to this review');
  await expect(detail.getByRole('textbox')).toHaveCount(0);await expect(detail.getByRole('region', {name:ui('Required photo views')})).toHaveCount(0);
  await capture(page,'app-review-denied',width,language,'actual same-company manager with no task-site assignment:403');
  await enter(page,`/exceptions/${fixture.review.id}`,'ownerB',language);
  await expect(detail.getByRole('alert')).toContainText(language==='ur'?'جائزہ دستیاب نہیں':'Review unavailable');
  await expect(detail.getByRole('textbox')).toHaveCount(0);await expect(detail.getByRole('region', {name:ui('Required photo views')})).toHaveCount(0);
  await capture(page,'app-review-unavailable',width,language,'actual foreign-company review lookup:404');
 });
});
// This is an explicitly intercepted presentation fixture. It cannot qualify a
// storage account, a real privacy screen, AI verification or native capture.
test('protected photo inspection supports keyboard panning and accessible control sizes',async({browser})=>{
 test.setTimeout(120000);
 await matrix(browser,async(page,width,language)=>{
  await page.route(`**/api/verification-exceptions/${fixture.review.id}`,async route=>{
   const response=await route.fetch(),body=await response.json(),requirement=body.data.items[0].requirements[0];
   const attempt={id:'spec36-presentation-attempt',state:'REVIEW_REQUIRED',privacyState:'SAFE',mediaAssetId:'spec36-presentation-image',receivedAt:'2026-10-29T04:00:00Z',createdAt:'2026-10-29T04:00:00Z',reviewSummary:{reasonCode:'SERVICE_FAILURE',cleanliness:null,dirtySurfaces:[],missingSurfaces:[]}};
   requirement.currentAttempt=attempt;requirement.currentAttemptId=attempt.id;requirement.state='REVIEW_REQUIRED';body.data.issues[0].latestAttempt=attempt;body.data.issues[0].reasonCode='SERVICE_FAILURE';
   await route.fulfill({response,json:body});
  });
  await page.route('**/api/evidence/spec36-presentation-image/content?*',route=>route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600"><rect width="1000" height="600" fill="white"/><path d="M100 100H900V500H100Z M200 0V600 M800 0V600" fill="none" stroke="blue" stroke-width="4"/><text x="500" y="300" text-anchor="middle" font-size="30">SYNTHETIC INSPECTION FIXTURE</text></svg>'}));
  await enter(page,`/exceptions/${fixture.review.id}`,'ownerA',language);
  await page.getByRole('region', {name:ui('Review photo')}).scrollIntoViewIfNeeded();
  const stage=page.getByRole('region', { name: ui('Photo inspection area') });await expect(stage.getByRole('img')).toBeVisible();
  await expect.poll(()=>stage.getByRole('img').evaluate((element:HTMLImageElement)=>element.complete&&element.naturalWidth>0)).toBe(true);
  const sizes=await page.getByRole('region', { name: ui('Review photo') }).getByRole('button').evaluateAll(elements=>elements.map(element=>{const r=element.getBoundingClientRect();return{width:r.width,height:r.height};}));
  for(const size of sizes){expect(size.width).toBeGreaterThanOrEqual(40);expect(size.height).toBeGreaterThanOrEqual(40);}
  await page.getByRole('region', { name: ui('Review photo') }).getByRole('button').nth(1).click();await stage.focus();
  await expect(stage).toBeFocused();await stage.press(language==='ur'?'ArrowLeft':'ArrowRight');
  await expect.poll(()=>stage.evaluate(element=>Math.abs(element.scrollLeft))).toBeGreaterThan(0);
  await capture(page,'http-fixture-keyboard-inspection',width,language,'labelled HTTP metadata/image presentation fixture; keyboard panning and44/48px control geometry');
  await page.getByRole('region', { name: ui('Review photo') }).getByRole('button').last().click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  const enlarged=dialog.getByRole('region', { name: ui('Enlarged photo inspection area') });await enlarged.focus();await expect(enlarged).toBeFocused();
  await page.screenshot({path:join(out,`http-fixture-enlarged-keyboard-${width}-${language}.png`)});
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('region', { name: ui('Review photo') }).getByRole('button').last()).toBeFocused();
 });
});
