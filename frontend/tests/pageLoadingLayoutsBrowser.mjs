import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=fileURLToPath(new URL('../..',import.meta.url));
const site={id:7,name:'Blue Area Office',address:'Islamabad',latitude:'33.72',longitude:'73.05',radiusMeters:500,timezone:'Asia/Karachi',isActive:true,staff:[],taskTemplates:[],taskInstances:[],_count:{staff:0,taskTemplates:0}};
const overview={locations:[],selected:[],days:[],date:'today',asOf:new Date().toISOString(),metrics:{present:0,scheduled:0,totalStaff:0,totalTasks:0,submitted:0,reviewCount:0,verified:0,accepted:0},chart:{submitted:0,inProgress:0,notStarted:0,overdue:0},attention:[],tasks:[],comparison:[]};
const worker={id:9,name:'Test Worker',email:'worker@example.test',role:'STAFF',isActive:true,location:site,shiftStart:null,shiftEnd:null,createdAt:'2026-10-01T00:00:00Z',periodLabel:'This month',taskStats:{totalTemplates:0,completed:0,pending:0,inProgress:0,missed:0},attendanceStats:{totalRecords:0,present:0,absent:0,late:0},taskTemplates:[],taskInstances:[],attendances:[]};
const cases=[
 {name:'team-detail-desktop',path:'/staff/9',target:'/api/staff/details/9',layout:'team-detail',metrics:5,shot:true},
 {name:'team-detail-mobile',path:'/staff/9',target:'/api/staff/details/9',layout:'team-detail',metrics:5,width:390,shot:true},
 {name:'team-attendance-tab',path:'/staff/9?tab=attendance',target:'/api/staff/details/9',layout:'team-detail',metrics:5},
 {name:'team-list',path:'/staff',target:'/api/staff/',layout:'team',metrics:3,shot:true},
 {name:'locations-list',path:'/locations',target:'/api/location/',layout:'locations',metrics:3},
 {name:'managers',path:'/managers',target:'/api/manager/',layout:'managers',metrics:3},
 {name:'attendance',path:'/attendance',target:'/api/attendance/',layout:'attendance',metrics:4,shot:true},
 {name:'location-overview',path:'/locations/7',target:'/api/location/7/stats',layout:'location-detail',metrics:4},
 {name:'location-staff-tab',path:'/locations/7?tab=staff',target:'/api/location/7/stats',layout:'location-detail',metrics:4},
 {name:'location-schedule-tab',path:'/locations/7?tab=schedule',target:'/api/location/7/stats',layout:'location-detail',metrics:4,shot:true},
 {name:'today',path:'/today-status',target:'/api/manager/operations/overview',layout:'today-summary',metrics:4},
 {name:'owner-overview',path:'/dashboard',target:'/api/manager/operations/overview',layout:'owner-overview',metrics:4},
 {name:'manager-overview',path:'/dashboard',target:'/api/manager/operations/overview',layout:'manager-overview',metrics:4,role:'MANAGER'},
 {name:'reviews',path:'/exceptions',target:'/api/verification-exceptions',layout:'reviews',metrics:0},
 {name:'review-detail',path:'/exceptions/8',target:'/api/verification-exceptions/8',layout:'review-detail',metrics:0,fail:true},
 {name:'area-inventory',path:'/areas/3',target:'/api/area/3',layout:'area',metrics:0},
 {name:'verification',path:'/verification/5',target:'/api/task-instance/5',layout:'verification',metrics:0,fail:true},
 {name:'billing-lazy-fallback',path:'/subscription',module:'/src/pages/Subscription/SubscriptionPage.tsx',layout:'billing',metrics:0,shot:true},
 {name:'setup-lazy-fallback',path:'/locations/7/areas/new',module:'/src/pages/Area/AreaSetupPage.tsx',layout:'area-setup',metrics:0},
 {name:'team-urdu-reduced',path:'/staff/9',target:'/api/staff/details/9',layout:'team-detail',metrics:5,width:390,urdu:true,reduce:true}
];
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try{for(const test of cases.filter(item=>!process.env.PAGES_CASE||item.name===process.env.PAGES_CASE)){
 const context=await browser.newContext({viewport:{width:test.width??1920,height:1080},reducedMotion:test.reduce?'reduce':'no-preference'});
 if(test.urdu)await context.addInitScript(()=>localStorage.setItem('hygene-ops.language','ur'));
 let release;const gate=new Promise(resolve=>{release=resolve;});const errors=[];
 if(test.module)await context.route('http://127.0.0.1:5178'+test.module,async route=>{await gate;await route.continue();});
 await context.route('http://127.0.0.1:5178/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(path===test.target)await gate;
  let data={};let status=200;
  if(path==='/api/common/get-current-user')data={id:1,companyId:1,role:test.role??'ADMIN',name:'Demo Owner',email:'owner@example.test'};
  else if(path==='/api/subscription')data={company:{id:1,plan:'PRO',subscriptionStatus:'ACTIVE'},usage:{locations:1,staff:0,managers:1},plan:{name:'Pro',limits:{locations:5,staff:25,managers:3},features:{managerAccess:true}},availablePlans:[]};
  else if(path==='/api/staff/details/9')data=worker;
  else if(path==='/api/staff/'||path==='/api/manager/'||path==='/api/attendance/')data=[];
  else if(path==='/api/location/'||path==='/api/location')data=[site];
  else if(path==='/api/location/7/stats')data={locationInfo:site,stats:{}};
  else if(path.includes('/operations/overview'))data=overview;
  else if(path.includes('/operations/staff')||path.includes('/operations/tasks'))data={...overview,rows:[],total:0,page:1,pageSize:20,totalPages:1};
  else if(path.includes('/areas'))data=[];
  else if(path==='/api/area/3')data={id:3,name:'East washroom',locationId:7,location:site,roomType:'WASHROOM',status:'ACTIVE',inventoryVersion:1,items:[],templates:[],standardPhotos:[]};
  else if(path==='/api/verification-exceptions')data={cases:[],total:0,unreadCount:0,page:1,pageSize:20,totalPages:1,locations:[],queueCounts:{'needs-me':0,staff:0,service:0,resolved:0}};
  if(path===test.target&&test.fail)status=503;
  try{await route.fulfill({status,json:{success:status===200,data,message:status===200?'OK':'Test service unavailable'}});}catch{}
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5178'+test.path,{waitUntil:'domcontentloaded'});
 const skeleton=page.locator('[data-loading-layout="'+test.layout+'"]');
 await skeleton.waitFor({timeout:30000}).catch(async e=>{console.log(test.name,errors,await page.locator('body').innerText());throw e;});
 const metricCount=await skeleton.locator('.sk-metrics').first().locator(':scope > .sk-metric').count().catch(()=>0);
 assert.equal(metricCount,test.metrics,test.name+' correct summary count');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,test.name+' no overflow');
 assert.equal(await skeleton.locator('input,button,a').count(),0);
 if(test.layout==='team-detail')assert.equal(await skeleton.locator('.sk-detail-media').count(),0,'no invented photo panel for team');
 if(test.reduce)assert.equal(await skeleton.locator('.sk-block').first().evaluate(el=>getComputedStyle(el,'::after').animationName),'none');
 if(test.shot)await page.screenshot({path:root+'/docs/loading-skeleton/page-layouts/'+test.name+'.png',fullPage:true});
 release();
 await skeleton.waitFor({state:'detached',timeout:15000});
 assert.deepEqual(errors,[],test.name+' no runtime errors');
 if(test.name==='team-detail-desktop'){
  await page.getByText('Profile',{exact:true}).waitFor({timeout:5000}).catch(async e=>{console.log('Loaded text',await page.locator('body').innerText());console.log('Errors',errors);throw e;});
  await page.screenshot({path:root+'/docs/loading-skeleton/page-layouts/team-detail-loaded.png',fullPage:true});
 }
 console.log(test.name+': matching structure and transition passed');await context.close();
}}finally{await browser.close();}
