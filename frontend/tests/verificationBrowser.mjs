// Browser fixtures, not a live provider/device/customer account.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_CORE_PATH??'playwright-core');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const user={id:1,companyId:1,role:'MANAGER',name:'Test manager',email:'test@example.invalid'};
const attempt={id:'safe-attempt',state:'REVIEW_REQUIRED',requirementId:'requirement-1',mediaAssetId:'safe-asset',privacyState:'SAFE',createdAt:'2026-10-06T10:00:00Z',staff:{id:2,name:'Test worker'}};
const issue={id:10,reasonCode:'CLEAN',state:'MANAGER_REVIEW',occurrences:1,requirementId:'requirement-1',requirement:{id:'requirement-1',viewKey:'BOWL_SEAT',state:'REVIEW_REQUIRED',item:{nameSnapshot:'Toilet 01'}},latestAttempt:attempt,latestAttemptId:attempt.id,recommendedAction:'Review this photo before accepting the evidence.',allowedActions:['ACCEPT_EVIDENCE','WAIVE_REQUIREMENT','MARK_MAINTENANCE','RESOLVE_ISSUE'],firstSeenAt:attempt.createdAt,lastSeenAt:attempt.createdAt};
const fixture={id:1,kind:'TASK',state:'MANAGER_REVIEW',priority:2,rowVersion:1,locationId:1,areaId:1,taskInstanceId:7,location:{id:1,name:'Test location',timezone:'Europe/London'},area:{id:1,name:'East washroom'},task:{id:7,title:'Evening clean',shiftEnd:'2026-10-06T17:00:00Z',verificationState:'NEEDS_REVIEW',staff:attempt.staff},issues:[issue],allowedActions:issue.allowedActions,attempts:[attempt],decisions:[],events:[{id:1,type:'ISSUE_RAISED',createdAt:attempt.createdAt}],unread:true};
let reads=0,decisions=[],filters=[],stale=true;const errors=[];
try{for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:900}});page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;if(!path.startsWith('/api/'))return route.continue();let data;
  if(path.endsWith('/common/get-current-user'))data=user;
  else if(path==='/api/verification-exceptions'){filters.push(url.search);data={cases:[fixture],nextCursor:null,total:1,unreadCount:reads?0:1};}
  else if(path==='/api/verification-exceptions/1/read'){reads++;data={managerId:1};}
  else if(path==='/api/verification-exceptions/1/actions'){
   const input=req.postDataJSON();decisions.push(input);if(stale){stale=false;fixture.rowVersion++;return route.fulfill({status:409,json:{message:'Case changed'}});}fixture.rowVersion++;fixture.task.completionOutcome='COMPLETED_WITH_EXCEPTIONS';fixture.state='RESOLVED';fixture.issues[0].state='RESOLVED';data={id:1};
  }else if(path==='/api/verification-exceptions/1')data=fixture;
  else if(path==='/api/evidence/safe-asset/content')return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6tAAAAABJRU5ErkJggg==','base64')});
  else if(path==='/api/location/')data=[{id:1,name:'Test location'}];
  else if(path==='/api/location/1/areas')data=[{id:1,name:'East washroom'}];
  else if(path.includes('locations'))data=[];
  else data={staffStatus:[],locations:[],summary:{}};
  await route.fulfill({json:{success:true,data}});
 });
 await page.goto(process.env.VERIFICATION_BROWSER_URL??'http://127.0.0.1:5179/exceptions');await page.waitForTimeout(1200);
 if(!await page.getByRole('heading',{name:'Exception inbox'}).isVisible().catch(()=>false))await page.evaluate(()=>{history.pushState({},'', '/exceptions');window.dispatchEvent(new PopStateEvent('popstate'));});
 await page.getByRole('heading',{name:'Exception inbox'}).waitFor({timeout:8000}).catch(async e=>{console.log({url:page.url(),body:await page.locator('body').innerText(),errors});throw e;});await page.getByLabel('Location',{exact:true}).selectOption('1');await page.waitForTimeout(200);assert.ok(filters.some(f=>f.includes('locationId=1')));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`Inbox overflow at ${width}`);
 const dir=process.env.VERIFICATION_BROWSER_ARTIFACTS??'../docs/verification/evidence';await mkdir(dir,{recursive:true});await page.screenshot({path:`${dir}/exception-inbox-${width}.png`,fullPage:true});
 await page.getByRole('link',{name:/East washroom.*Evening clean/}).click();await page.getByRole('heading',{name:'East washroom'}).waitFor();await page.waitForTimeout(200);assert.ok(reads>0);const image=page.getByRole('img',{name:'Verification evidence'});await image.waitFor();assert.match(await image.getAttribute('src'),/^blob:/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`Case overflow at ${width}`);
 if(width===1440){await page.getByLabel('Decision',{exact:true}).selectOption('MARK_MAINTENANCE');assert.ok(await page.getByText(/Required evidence remains unresolved/).isVisible());await page.getByLabel('Decision',{exact:true}).selectOption('WAIVE_REQUIREMENT');await page.getByLabel('Reason',{exact:true}).selectOption('DAMAGED');await page.getByLabel('Decision note').fill('Inspected damaged fixture. Explicit waiver for this task.');await page.getByRole('button',{name:'Waive requirement',exact:true}).click();await page.getByText(/This case changed/).waitFor();assert.match(await page.getByLabel('Decision note').inputValue(),/Explicit waiver/);await page.getByRole('button',{name:'Refresh case'}).click();await page.waitForTimeout(250);await page.getByRole('button',{name:'Waive requirement',exact:true}).click();await page.getByText('Current outcome: Completed with exceptions').waitFor();assert.equal(decisions.at(-1).expectedVersion,2);}
 await page.screenshot({path:`${dir}/exception-detail-${width}.png`,fullPage:true});await page.close();
}assert.deepEqual(errors,[]);console.log('PASS: 1440/390px inbox/detail, filters, read receipt, protected blob image, maintenance/waiver copy, stale conflict, retained note and completion outcome (API fixtures).');}finally{await browser.close();}
