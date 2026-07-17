import { ui, copy } from './workspace-helpers';
import {test,expect,fixture,enter,backend,sql} from './fixtures';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Browser,Page} from '@playwright/test';
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=join(root,'frontend/e2e/.artifacts/evidence/v5-review-state-evidence');
const observations:unknown[]=[];
const savedNote='Synthetic inspection recorded through the real closure API. No photos or task outcomes were changed.';
let setupId:number,closedId:number,closedTaskId:number,heldId:number,heldAsset:string;
test.use({trace:'off',screenshot:'off',video:'off'});


test.beforeEach(async()=>{
 await mkdir(out,{recursive:true});
 // Only the managed runner's new UUID child database receives these synthetic rows.
 const setups=await sql(`WITH rooms AS (
  INSERT INTO "Area" ("locationId",name,"roomType","qrNonce","updatedAt")
  SELECT $1,'Synthetic setup room '||lpad(n::text,2,'0'),'WASHROOM',gen_random_uuid()::text,CURRENT_TIMESTAMP FROM generate_series(1,25) n RETURNING id,name
 ), reviews AS (
  INSERT INTO "VerificationException" ("companyId","locationId","areaId",kind,"dedupeKey",state,priority,"firstRaisedAt","updatedAt")
  SELECT $2,$1,id,'SETUP','review-state-setup:'||id,'OPEN',5,CURRENT_TIMESTAMP+((right(name,2)::int)*interval '1 second'),CURRENT_TIMESTAMP FROM rooms RETURNING id
 ), issues AS (
  INSERT INTO "VerificationIssue" ("exceptionId","dedupeKey","reasonCode","recommendedAction") SELECT id,'setup-required','SETUP_REQUIRED','CONFIGURE_AREA' FROM reviews
 ) SELECT id FROM reviews ORDER BY id`,[fixture.site.A,fixture.company.A]);
 setupId=setups[0].id;
 const cloned=await sql(`INSERT INTO "TaskInstance" (title,date,"shiftStart","shiftEnd",status,"startedAt","staffId","locationId","areaId","verificationVersion","areaNameSnapshot","inventoryVersion","policySnapshot","verificationDeadline","uploadDeadline","updatedAt") SELECT 'Synthetic recorded review',date,"shiftStart","shiftEnd",status,"startedAt","staffId","locationId","areaId","verificationVersion","areaNameSnapshot","inventoryVersion","policySnapshot","verificationDeadline","uploadDeadline",CURRENT_TIMESTAMP FROM "TaskInstance" WHERE id=$1 RETURNING id,"areaId"`,[fixture.review.taskId]);
 closedTaskId=cloned[0].id;
 const closed=await sql(`INSERT INTO "VerificationException" ("companyId","locationId","areaId","taskInstanceId",kind,"dedupeKey",state,priority,"updatedAt") VALUES ($1,$2,$3,$4,'TASK',$5,'MANAGER_REVIEW',10,CURRENT_TIMESTAMP) RETURNING id`,[fixture.company.A,fixture.site.A,cloned[0].areaId,closedTaskId,'review-state-closed:'+randomUUID()]);
 closedId=closed[0].id;
 await sql(`INSERT INTO "VerificationIssue" ("exceptionId","dedupeKey","reasonCode","recommendedAction") VALUES ($1,'missing-view','MISSING_EVIDENCE','UPLOAD_REQUIRED_PHOTO')`,[closedId]);
 // A persisted HOLD and an unavailable synthetic locator prove recorded privacy state,
 // never successful provider bytes or an actual privacy evaluation.
 const task=await sql(`INSERT INTO "TaskInstance" (title,date,"shiftStart","shiftEnd",status,"startedAt","staffId","locationId","areaId","verificationVersion","areaNameSnapshot","inventoryVersion","policySnapshot","verificationDeadline","uploadDeadline","updatedAt") SELECT 'Synthetic held review',date,"shiftStart","shiftEnd",status,"startedAt","staffId","locationId","areaId","verificationVersion","areaNameSnapshot","inventoryVersion","policySnapshot","verificationDeadline","uploadDeadline",CURRENT_TIMESTAMP FROM "TaskInstance" WHERE id=$1 RETURNING id,"areaId"`,[fixture.review.taskId]);
 const taskId=task[0].id,areaId=task[0].areaId;
 const item=await sql(`INSERT INTO "TaskVerificationItem" ("taskInstanceId","areaId","sourceAreaItemId","itemCodeSnapshot","nameSnapshot","typeSnapshot","orderSnapshot","identificationSnapshot","rubricSnapshot") SELECT $1,"areaId","sourceAreaItemId","itemCodeSnapshot","nameSnapshot","typeSnapshot","orderSnapshot","identificationSnapshot","rubricSnapshot" FROM "TaskVerificationItem" WHERE "taskInstanceId"=$2 LIMIT 1 RETURNING id`,[taskId,fixture.review.taskId]);
 const requirement=randomUUID(),session=randomUUID(),slot=randomUUID(),attempt=randomUUID();heldAsset=randomUUID();
 await sql(`INSERT INTO "TaskEvidenceRequirement" (id,"taskVerificationItemId","viewKey","instructionsSnapshot",state) VALUES ($1,$2,'basin','Show the synthetic sink basin','CLEANING_REQUIRED')`,[requirement,item[0].id]);
 const assignment=await sql(`INSERT INTO "TaskAssignment" ("taskInstanceId","staffId","updatedAt") VALUES ($1,$2,CURRENT_TIMESTAMP) RETURNING id`,[taskId,fixture.staff.recovery.id]);
 await sql(`INSERT INTO "CaptureSession" (id,"taskInstanceId","areaId","staffId","assignmentId","assignmentEpoch","deviceId","qrVersion","policyVersion","captureExpiresAt","uploadExpiresAt","presenceStatus","locationCheck","serverTimeAnchor","clientBootId") VALUES ($1,$2,$3,$4,$5,0,'synthetic-device',1,1,CURRENT_TIMESTAMP+interval '1 hour',CURRENT_TIMESTAMP+interval '1 hour','SYNTHETIC','{}',CURRENT_TIMESTAMP,'synthetic-boot')`,[session,taskId,areaId,fixture.staff.recovery.id,assignment[0].id]);
 await sql(`INSERT INTO "CaptureSlot" (id,"sessionId","requirementId",sequence,"nonceHash","expiresAt") VALUES ($1,$2,$3,1,'synthetic-nonce',CURRENT_TIMESTAMP+interval '1 hour')`,[slot,session,requirement]);
 await sql(`INSERT INTO "EvidenceAsset" (id,"companyId","locationId","taskInstanceId","originalPublicId",format,bytes,width,height,sha256,"privacyState") VALUES ($1,$2,$3,$4,$5,'png',0,1,1,'synthetic-not-image-bytes','HOLD')`,[heldAsset,fixture.company.A,fixture.site.A,taskId,'synthetic-unavailable:'+heldAsset]);
 await sql(`INSERT INTO "VerificationAttempt" (id,"requirementId","sessionId","slotId","staffId","assignmentEpoch","mediaAssetId","clientCaptureId","claimedCapturedAt","anchoredElapsedMs","receivedAt","timingEvidence",state,"cleanlinessResult") VALUES ($1,$2,$3,$4,$5,0,$6,'synthetic-held-capture',CURRENT_TIMESTAMP,0,CURRENT_TIMESTAMP,'SYNTHETIC','PRIVACY_HOLD','{"reasonCode":"PRIVACY_HOLD","cleanliness":null}')`,[attempt,requirement,session,slot,fixture.staff.recovery.id,heldAsset]);
 await sql(`UPDATE "TaskEvidenceRequirement" SET "currentAttemptId"=$1 WHERE id=$2`,[attempt,requirement]);
 const held=await sql(`INSERT INTO "VerificationException" ("companyId","locationId","areaId","taskInstanceId",kind,"dedupeKey",state,priority,"updatedAt") VALUES ($1,$2,$3,$4,'TASK',$5,'MANAGER_REVIEW',20,CURRENT_TIMESTAMP) RETURNING id`,[fixture.company.A,fixture.site.A,areaId,taskId,'review-state-held:'+randomUUID()]);heldId=held[0].id;
 await sql(`INSERT INTO "VerificationIssue" ("exceptionId","dedupeKey","reasonCode","recommendedAction","requirementId","latestAttemptId") VALUES ($1,'privacy-held','PRIVACY_HOLD','REVIEW_PRIVACY',$2,$3)`,[heldId,requirement,attempt]);
});

async function capture(page:Page,name:string,width:number,language:string,provenance='real API + synthetic persisted SQL') {
 await page.evaluate(()=>document.fonts.ready);
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
 expect(overflow).toBe(false);
 await page.screenshot({path:join(out,`app-${name}-${width}-${language}.png`),fullPage:true});
 observations.push({name,width,height:900,language,overflow,provenance});
 await writeFile(join(out,'render-results.json'),JSON.stringify(observations,null,2));
}
async function matrix(browser:Browser,action:(page:Page,width:number,lang:string)=>Promise<void>) {
 for(const width of [1366,390])for(const lang of ['en','ur']) {
  const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  try {await action(page,width,lang);expect(errors).toEqual([]);} finally {await context.close();}
 }
}

test('recorded SETUP reviews explain no generated task and offer only the existing setup destination',async({browser})=>{
 test.setTimeout(120000);
 await matrix(browser,async(page,width,lang)=>{
  await enter(page,`/exceptions/${setupId}`,'ownerA',lang);
  await expect(page.locator('section').filter({ has: page.getByRole('heading', { name: ui('Room inventory needs setup'), exact: true }) })).toBeVisible();
  await expect(page.getByRole('region', { name: ui('Your decision') })).toHaveCount(0);
  await expect(page.getByRole('region', { name: ui('Review summary') })).not.toContainText(lang==='ur'?'کارکردگی':'staff performance');
  await expect(page.getByRole('link', { name: ui('Review room setup') })).toHaveAttribute('href',new RegExp(`/locations/${fixture.site.A}\\?tab=templates`));
  await expect(page.getByRole('main')).toContainText(lang==='ur'?'کوئی کام تیار نہیں ہوا':'No task generated');
  await capture(page,'setup',width,lang);
  const denied=await page.request.post(backend+`/api/verification-exceptions/${setupId}/close`,{data:{requestId:randomUUID(),expectedVersion:0,action:'RESOLVE_REVIEW',note:'Synthetic setup cannot receive a staff closure'}});expect(denied.status()).toBe(409);
 });
});

test('real saved closure displays the V5 decision facts and leaves task outcomes unchanged after reload',async({browser,request})=>{
 test.setTimeout(120000);
 const before=await sql(`SELECT status,"staffSubmittedAt","completionOutcome","verificationState" FROM "TaskInstance" WHERE id=$1`,[closedTaskId]);
 const response=await request.post(backend+'/api/manager/manager-login',{data:{email:fixture.users.ownerA.email,password:fixture.password}});expect(response.status()).toBe(200);
 const closed=await request.post(backend+`/api/verification-exceptions/${closedId}/close`,{data:{requestId:randomUUID(),expectedVersion:0,action:'RESOLVE_REVIEW',note:savedNote}});expect(closed.status()).toBe(200);
 await matrix(browser,async(page,width,lang)=>{
  await enter(page,`/exceptions/${closedId}?returnTo=${encodeURIComponent('/exceptions?queue=resolved')}`,'ownerA',lang);
  const panel=page.getByRole('region', { name: ui('Decision recorded') });await expect(panel).toBeVisible();
  await expect(panel).toContainText(savedNote);await expect(panel).toContainText('E2E owner A');await expect(panel.locator('time')).toHaveAttribute('datetime',/.+/);
  await expect(panel.locator('textarea,button[type=submit]')).toHaveCount(0);
  await page.reload();await expect(panel).toContainText(savedNote);await expect(panel.locator('a')).toBeVisible();
  await capture(page,'closed',width,lang);
  await panel.scrollIntoViewIfNeeded();await page.screenshot({path:join(out,`app-closed-decision-${width}-${lang}.png`)});
  const pending=panel.locator('a');await expect(pending).toHaveAttribute('href',/returnTo=.*needs-me/);await pending.click();await expect(page.locator('section').filter({ has: page.getByRole('heading', { name: ui('Room inventory needs setup'), exact: true }) })).toBeVisible();
 });
 expect(await sql(`SELECT status,"staffSubmittedAt","completionOutcome","verificationState" FROM "TaskInstance" WHERE id=$1`,[closedTaskId])).toEqual(before);
});

test('persisted privacy hold overrides an older cleaning label while private bytes and foreign-site access remain denied',async({browser})=>{
 test.setTimeout(120000);
 await matrix(browser,async(page,width,lang)=>{
  await enter(page,`/exceptions/${heldId}`,'managerA',lang);
  await expect(page.getByRole('region', { name: ui('Required photo views') })).toContainText(copy('Privacy review needed', lang));
  await page.getByRole('region', {name:ui('Review photo')}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('region', { name: ui('Review photo') }).getByRole('alert')).toBeVisible();
  await expect(page.getByRole('region', { name: ui('Review photo') }).getByRole('img')).toHaveCount(0);
  await capture(page,'held-unavailable',width,lang);
  const details=await page.request.get(backend+`/api/verification-exceptions/${heldId}`);expect(details.status()).toBe(200);
  expect((await details.json()).data.items[0].requirements[0].currentAttempt.privacyState).toBe('HOLD');
  await enter(page,`/exceptions/${heldId}`,'managerB',lang);
  await expect(page.getByRole('main').getByRole('alert').last()).toBeVisible();
  expect((await page.request.get(backend+`/api/verification-exceptions/${heldId}`)).status()).toBe(403);
  expect((await page.request.get(backend+`/api/evidence/${heldAsset}/content?variant=review`)).status()).toBe(403);
  await capture(page,'held-site-denied',width,lang);
 });
});

test('large persisted queues paginate, retain filters and open the next review without duplicate records',async({browser})=>{
 test.setTimeout(120000);
 await matrix(browser,async(page,width,lang)=>{
  await enter(page,'/exceptions?queue=needs-me&reasonCode=SETUP_REQUIRED&pageSize=20','ownerA',lang);
  const records=page.getByRole('region', { name: ui('Review queue') }).getByRole('link');await expect(records).toHaveCount(20);await expect(page.locator('section').filter({ has: page.getByRole('heading', { name: ui('Room inventory needs setup'), exact: true }) })).toHaveCount(1);
  const first=await records.first().getAttribute('href');
  await capture(page,'large-queue-page1',width,lang);
  await page.getByRole('button', { name: ui('Next') }).click();await expect(page).toHaveURL(/page=2/);await expect(records).toHaveCount(5);await expect(page.locator('section').filter({ has: page.getByRole('heading', { name: ui('Room inventory needs setup'), exact: true }) })).toHaveCount(1);
  await expect(page).toHaveURL(/reasonCode=SETUP_REQUIRED/);expect(await records.first().getAttribute('href')).not.toBe(first);
  await capture(page,'large-queue-page2',width,lang);
  await records.first().click();await expect(page.locator('section').filter({ has: page.getByRole('heading', { name: ui('Room inventory needs setup'), exact: true }) })).toBeVisible();
  await expect(page).toHaveURL(/returnTo=/);
  const next=page.getByRole('navigation', { name: ui('Review navigation') }).getByRole('link').last();await expect(next).toHaveAttribute('href',new RegExp('/exceptions/\\d+\\?returnTo='));
  await next.click();await expect(page.locator('section').filter({ has: page.getByRole('heading', { name: ui('Room inventory needs setup'), exact: true }) })).toBeVisible();
 });
});

test('loading and failed reads have explicit recovery and never show a false zero queue',async({browser})=>{
 test.setTimeout(120000);
 await matrix(browser,async(page,width,lang)=>{
  let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/verification-exceptions?*',async route=>{await gate;await route.continue();});
  await enter(page,'/exceptions','ownerA',lang);
  await expect(page.getByRole('region', { name: ui('Review queue') }).getByRole('status')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Pending.*0|زیر.*0/ })).toHaveCount(0);
  await capture(page,'loading',width,lang,'delayed real API request; no positive response replaced');
  release();await page.unrouteAll({behavior:'wait'});await expect(page.getByRole('region', { name: ui('Review queue') }).getByRole('link').first()).toBeVisible();
  await page.route('**/api/verification-exceptions?*',route=>route.abort());await page.reload();
  await expect(page.getByRole('region', { name: ui('Review queue') }).getByRole('alert')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Pending.*0|زیر.*0/ })).toHaveCount(0);await expect(page.getByRole('region', { name: ui('Review queue') }).getByRole('link')).toHaveCount(0);
  await capture(page,'network-error',width,lang,'labelled network-abort fault seam; no positive response replaced');
  await page.unroute('**/api/verification-exceptions?*');await page.getByRole('region', { name: ui('Review queue') }).getByRole('button', { name: ui('Retry') }).click();await expect(page.getByRole('region', { name: ui('Review queue') }).getByRole('link').first()).toBeVisible();
 });
});
