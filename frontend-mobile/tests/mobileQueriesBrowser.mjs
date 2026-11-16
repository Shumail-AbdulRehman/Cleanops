import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.MOBILE_TEST_ORIGIN||'http://127.0.0.1:5191';
const dir=process.env.MOBILE_SCREENSHOTS||'/tmp/hygene-mobile-queries-ui';await mkdir(dir,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try{for(const width of [390,1440]){
 const context=await browser.newContext({viewport:{width,height:950}}),errors=[],requests=[];
 const user={id:2,companyId:1,role:'STAFF',name:'Test worker',email:'staff@example.test',locationId:1};
 const now=new Date(),end=new Date(+now+6*3600000).toISOString();
 const tasks=Array.from({length:80},(_,i)=>({id:i+1,title:`Cleaning task ${i+1}`,status:'PENDING',verificationVersion:2,date:now.toISOString(),shiftStart:now.toISOString(),shiftEnd:end,startedAt:null,completedAt:null,proofImageUrls:[],location:{id:1,name:'Test location',timezone:'Asia/Karachi'}}));
 await context.addInitScript(({user})=>localStorage.setItem('@cleanops-staff/auth',JSON.stringify({user,accessToken:'fixture-access',refreshToken:'fixture-refresh'})),{user});
 await context.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname;
  const headers={'access-control-allow-origin':origin,'access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-credentials':'true'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  requests.push(p+(url.search||''));let data={};
  if(p==='/api/common/get-current-user')data=user;
  else if(p==='/api/staff/mobile/tasks'){
   await new Promise(resolve=>setTimeout(resolve,60));
   data={tasks:url.searchParams.has('cursor')?tasks.slice(50):tasks.slice(0,50),counts:{total:80,submitted:0,pending:80,inProgress:0},nextCursor:url.searchParams.has('cursor')?null:'second-page'};
  }else if(p==='/api/staff/mobile/attendance')data=[{id:1,date:now.toISOString(),status:'CHECKED_IN',expectedStart:new Date(+now-3600000).toISOString(),expectedEnd:end,checkInTime:new Date(+now-3600000).toISOString(),checkOutTime:null}];
  else if(p.includes('/verification-work')||p.endsWith('/today'))throw new Error('Mobile must not request legacy overlapping task lists');
  await route.fulfill({headers,json:{success:true,data}});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);

 await page.getByText('0 of 80 submitted',{exact:true}).waitFor();
 assert.equal(requests.filter(p=>p==='/api/staff/mobile/tasks').length,1);
 assert.equal(requests.filter(p=>p.startsWith('/api/staff-notifications/')).length,0,'no inbox or badge polling remains');
 await page.getByRole('tab',{name:/Tasks/}).click();
 await page.getByText('Cleaning task 50',{exact:true}).waitFor();
 assert.equal(await page.getByText('Cleaning task 51',{exact:true}).count(),0);
 await page.getByText('80 not started · 0 in progress',{exact:true}).waitFor();
 assert.equal(requests.filter(p=>p==='/api/staff/mobile/tasks').length,1,'tab uses shared fresh cache');
 await page.getByRole('button',{name:'Load more tasks',exact:true}).click();
 await page.getByText('Cleaning task 80',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Load more tasks',exact:true}).waitFor({state:'hidden'});
 assert.equal(requests.filter(p=>p.startsWith('/api/staff/mobile/tasks?cursor=')).length,1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:`${dir}/tasks-${width}.png`,fullPage:true});
 assert.deepEqual(errors,[]);console.log(`PASS ${width}px: single initial task request, shared tab cache, no inbox polling, accurate totals and on-demand pages`);
 await context.close();
}}finally{await browser.close();}
