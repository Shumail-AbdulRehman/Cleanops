import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.REVIEW_TEST_ORIGIN||'http://127.0.0.1:5173';
const screenshots=process.env.REVIEW_SCREENSHOTS||'/tmp/priv-review-diagnosis';await mkdir(screenshots,{recursive:true});
const missing=(id,view)=>({id,viewKey:view,instructionsSnapshot:'Show the whole required surface.',mandatory:true,state:'MISSING',decisionVersion:1,currentAttemptId:null,currentAttempt:null,allowedActions:[]});
const dirty={id:'pan-attempt',state:'CLEANING_REQUIRED',mediaAssetId:null,privacyState:'DISCARDED',createdAt:'2026-10-18T07:10:00Z',receivedAt:'2026-10-18T07:10:00Z',reviewSummary:{reasonCode:'CLEANING_REQUIRED',cleanliness:'DIRTY',dirtySurfaces:['pan'],missingSurfaces:[]}};
function fixture(id,name,view,attempt){return{id,nameSnapshot:name,sourceAreaItemId:id,mandatory:true,requirements:[{...missing(String(id),view),...(attempt?{state:attempt.state==='RECAPTURE_REQUIRED'?'RECAPTURE_REQUIRED':attempt.state==='CLEANING_REQUIRED'?'CLEANING_REQUIRED':'REVIEW_REQUIRED',currentAttemptId:attempt.id,currentAttempt:attempt}:{} )}]};}
const base={id:1,kind:'TASK',state:'MANAGER_REVIEW',rowVersion:1,priority:2,locationId:7,areaId:8,taskInstanceId:101,firstRaisedAt:'2026-10-18T07:30:00Z',updatedAt:'2026-10-18T07:30:00Z',serverTime:'2026-10-18T08:00:00Z',location:{id:7,name:'Riphah International University',timezone:'Asia/Karachi'},area:{id:8,name:'A block washroom'},task:{id:101,title:'Washroom cleaning',status:'IN_PROGRESS',staff:{id:9,name:'Ali Raza Khan'},shiftEnd:'2026-10-18T07:30:00Z',verificationDeadline:'2026-10-18T07:30:00Z'},captureStatus:{available:false,reason:'DEADLINE_PASSED',canExtend:false,deadline:'2026-10-18T07:30:00Z'},closureActions:['RESOLVE_REVIEW','RECORD_PERFORMANCE_ISSUE'],performanceStaffOptions:[{id:9,name:'Ali Raza Khan'}],allowedActions:[],standards:[],decisions:[],events:[],attempts:[],issues:[{id:1,reasonCode:'MISSING_EVIDENCE',state:'MANAGER_REVIEW',occurrences:1,allowedActions:[],blockedReason:'This task cannot receive another photo now. Check the photo deadline and available options.'}],items:[fixture(1,'Indian toilet 01','squat_pan',dirty),fixture(2,'Sink 01','basin_tap'),fixture(3,'Mirror 01','reflective_surface'),fixture(4,'Floor zone 01','wide_zone')]};
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:1000}});let current=structuredClone(base);const errors=[],decisions=[];let conflict=false;
  await context.route(origin+'/api/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;let data={};
   if(path==='/api/common/get-current-user')data={id:1,companyId:1,role:width===390?'MANAGER':'ADMIN',name:'Demo Manager',email:'manager@test.invalid'};
   else if(path==='/api/subscription')data={company:{id:1,subscriptionStatus:'ACTIVE'},usage:{locations:1,staff:1,managers:1},plan:{name:'Pro',limits:{locations:5,staff:25,managers:3},features:{managerAccess:true}}};
   else if(path==='/api/verification-exceptions/1')data=current;
   else if(path==='/api/verification-exceptions/1/next')data={nextId:null};
   else if(path==='/api/verification-exceptions/count')data={total:1};
   else if(path.endsWith('/close')){
    const decision=request.postDataJSON();decisions.push(decision);
    if(conflict)return route.fulfill({status:409,json:{success:false,message:'This review changed.'}});
    current={...current,state:'RESOLVED',rowVersion:current.rowVersion+1,closureActions:[],issues:current.issues.map(issue=>({...issue,state:'RESOLVED'}))};
    data={id:99,action:decision.action};
   }
   else if(path.endsWith('/actions')){decisions.push(request.postDataJSON());throw new Error('Viewing explanations must not submit a decision');}
   else if(path.startsWith('/api/evidence/'))return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNUcAAAAASUVORK5CYII=','base64')});
   await route.fulfill({json:{success:true,data}});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/exceptions/1');
  const summary=page.getByRole('region',{name:'Review summary'});
  await summary.getByRole('heading',{name:'Cleaning is incomplete',exact:true}).waitFor();
  const group=summary.locator('[data-kind="missing"]');
  assert.match(await group.innerText(),/Sink 01/);assert.match(await group.innerText(),/Mirror 01/);assert.match(await group.innerText(),/Floor zone 01/);
  assert.equal(await group.locator('.ops-review-finding-title > span').innerText(),'3');
  assert.match(await summary.innerText(),/toilet pan.*needing cleaning/);
  assert.match(await summary.innerText(),/stays in exceptions until you save a decision/s);
  assert.equal(await page.getByText('No decision is available for this issue. Refresh the review or check your location access.',{exact:true}).count(),0);
  await page.getByText('Rejected photo was not kept',{exact:true}).waitFor();
  assert.equal(await page.getByText('No photo received for this view',{exact:true}).count(),0,'a rejected photo must not be described as never received');
  await page.screenshot({path:`${screenshots}/incomplete-${width}.png`,fullPage:true});
  await summary.getByRole('button',{name:/Inspect Sink 01/}).click();
  await page.locator('.ops-action-column .ops-guidance').filter({hasText:'No photo has been received for this required view.'}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('requirementId'),'2');
  await page.getByText('This required photo is missing',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole('button',{name:'اردو',exact:true}).click();
  await page.getByRole('region',{name:'جائزے کا خلاصہ'}).waitFor();
  assert.match(await page.locator('.ops-review-summary').innerText(),/مہلت گزر چکی/);
  assert.match(await page.locator('.ops-review-summary').innerText(),/بیت الخلا/);
  await page.screenshot({path:`${screenshots}/incomplete-urdu-${width}.png`,fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole('button',{name:'English',exact:true}).click();
  for(const [name,reason,state,privacy,verdict,text]of[
   ['clean-approval','AUTO_PASS_NOT_VALIDATED','REVIEW_REQUIRED','NOT_REQUIRED','CLEAN',/marked.*clean.*automatic approval is not enabled/s],
   ['service-failure','SERVICE_FAILURE','REVIEW_REQUIRED','NOT_REQUIRED',null,/checking failure, not a finding/],
   ['ambiguous-condition','CANNOT_ASSESS','REVIEW_REQUIRED','NOT_REQUIRED','CANNOT_ASSESS',/stains, wear, damage or visibility/],
   ['wrong-object','WRONG_ITEM','RECAPTURE_REQUIRED','DISCARDED',null,/different object instead of/],
   ['privacy','PRIVACY_HOLD','REVIEW_REQUIRED','HOLD',null,/restricted for a privacy review/],
  ]){
   const attempt={...dirty,id:name,state,privacyState:privacy,mediaAssetId:privacy==='DISCARDED'?null:'image-'+name,reviewSummary:{reasonCode:reason,cleanliness:verdict,dirtySurfaces:[],missingSurfaces:[]}};
   current=structuredClone(base);current.captureStatus={available:true,reason:'AVAILABLE',canExtend:false,deadline:'2026-10-18T10:00:00Z'};
   current.items=[fixture(1,'Indian toilet 01','squat_pan',attempt)];
   current.items[0].requirements[0].allowedActions=['ACCEPT_EVIDENCE','REQUEST_RECAPTURE'];
   current.issues=[{id:10,requirementId:'1',reasonCode:reason,state:'MANAGER_REVIEW',latestAttempt:attempt,latestAttemptId:attempt.id,allowedActions:['ACCEPT_EVIDENCE','REQUEST_RECAPTURE']}];
   await page.goto(origin+'/exceptions/1');
   await page.locator('.ops-action-column .ops-guidance').waitFor();
   assert.match(await page.locator('.ops-action-column .ops-guidance').innerText(),text);
   await page.getByRole('button',{name:'Resolve review',exact:true}).waitFor();
   if(name==='privacy')assert.equal(await page.getByRole('button',{name:'Accept this photo',exact:true}).count(),0);
   if(name==='service-failure')assert.equal(await page.locator('[data-kind="cleaning"]').count(),0);
   await page.screenshot({path:`${screenshots}/${name}-${width}.png`,fullPage:true});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  current=structuredClone(base);current.captureStatus.canExtend=true;current.allowedActions=['EXTEND_WINDOW'];
  await page.goto(origin+'/exceptions/1');
  await page.getByRole('button',{name:'Resolve review',exact:true}).waitFor();
  for(const label of ['View time extension','Give more time for photos','Request another photo','Request more cleaning','Accept this photo','Other manager options'])assert.equal(await page.getByRole('button',{name:label,exact:true}).count(),0);
  assert.equal(await page.getByText('Previous decisions and earlier photos',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Resolve review',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Confirm resolution',exact:true}).isDisabled(),true);
  await page.getByLabel('Resolution note',{exact:true}).fill('Inspected on site; this review can be closed.');
  await page.screenshot({path:`${screenshots}/resolve-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Confirm resolution',exact:true}).click();
  await page.getByText('This review has been handled. No further manager decision is needed.',{exact:true}).waitFor();
  assert.equal(current.state,'RESOLVED');assert.equal(decisions.length,1);assert.equal(decisions[0].action,'RESOLVE_REVIEW');
  current=structuredClone(base);
  await page.goto(origin+'/exceptions/1');
  await page.getByRole('button',{name:'Record staff performance issue',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Record issue and close review',exact:true}).isDisabled(),true);
  await page.getByLabel('Performance category',{exact:true}).selectOption('MISSING_PHOTOS');
  await page.getByLabel('Performance note',{exact:true}).fill('Required photos were not submitted; confirmed with staff.');
  conflict=true;
  await page.getByRole('button',{name:'Record issue and close review',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Your note is kept.'}).waitFor();
  assert.equal(await page.getByLabel('Performance note',{exact:true}).inputValue(),'Required photos were not submitted; confirmed with staff.');
  assert.equal(current.state,'MANAGER_REVIEW');
  await page.getByRole('button',{name:'Refresh review',exact:true}).click();
  await page.screenshot({path:`${screenshots}/performance-${width}.png`,fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  conflict=false;
  await page.getByRole('button',{name:'Record issue and close review',exact:true}).click();
  await page.getByText('This review has been handled. No further manager decision is needed.',{exact:true}).waitFor();
  assert.equal(current.state,'RESOLVED');assert.equal(decisions.length,3);
  assert.equal(decisions[2].action,'RECORD_PERFORMANCE_ISSUE');assert.equal(decisions[2].staffId,9);assert.equal(decisions[2].category,'MISSING_PHOTOS');
  assert.equal(decisions[1].requestId,decisions[2].requestId,'unchanged retry must keep the request id');
  assert.deepEqual(errors,[]);
  console.log(`PASS ${width}px: saved finding explanations, Urdu, no overflow, two closure outcomes, mandatory notes/category, conflict preserves note and request identity, no photo-request controls or history section`);
  await context.close();
 }
}finally{await browser.close();}
