import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.NOTIFICATIONS_TEST_ORIGIN || 'http://127.0.0.1:5191';
const dir=process.env.NOTIFICATIONS_SCREENSHOTS || '/tmp/hygene-push-only-ui';await mkdir(dir,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try{for(const width of [390,1440]){
 const context=await browser.newContext({viewport:{width,height:950}}),errors=[],requests=[];
 const user={id:2,companyId:1,role:'STAFF',name:'Test worker',email:'staff@example.test',locationId:1};
 await context.addInitScript(({user})=>localStorage.setItem('@cleanops-staff/auth',JSON.stringify({user,accessToken:'fixture-access',refreshToken:'fixture-refresh'})),{user});
 await context.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname;
  const headers={'access-control-allow-origin':origin,'access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PUT,DELETE,OPTIONS','access-control-allow-credentials':'true'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  requests.push(p);let data={};
  if(p==='/api/common/get-current-user')data=user;
  else if(p==='/api/staff/mobile/tasks')data={tasks:[],counts:{total:0,submitted:0,pending:0,inProgress:0},nextCursor:null};
  else if(p==='/api/staff/mobile/attendance')data=[];
  await route.fulfill({headers,json:{success:true,data}});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);
 await page.getByRole('tab',{name:/Help & account/}).click({timeout:20000});
 await page.getByText('Your workflow',{exact:true}).waitFor();
 await page.getByText('Check in, complete your cleaning tasks, and upload every required photo.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:/Listen|Notifications/}).count(),0);
 assert.equal(await page.getByRole('tab').count(),3);
 assert.equal(requests.filter(path=>path.startsWith('/api/staff-notifications')).length,0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:`${dir}/help-${width}.png`,fullPage:true});
 await page.getByRole('tab',{name:/Tasks/}).click();
 await page.getByRole('tab',{name:/Tasks/}).waitFor();
 assert.equal(await page.getByRole('button',{name:/Listen|Notifications/}).count(),0);
 assert.deepEqual(errors,[]);
 console.log(`PASS mobile web ${width}px: no Listen, notification page/badge, or inbox polling; Help and Tasks remain usable`);
 await context.close();
}}finally{await browser.close();}
