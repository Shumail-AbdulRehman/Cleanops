import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const origin=process.env.PERFORMANCE_ORIGIN||'http://127.0.0.1:5197';
const output=process.env.PERFORMANCE_SCREENSHOTS||'/tmp/priv-performance/screenshots';await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const base={scheduledShifts:20,present:18,late:2,missing:2,tasks:30,submitted:24,verified:15,accepted:3,inProgress:2,overdue:2,notStarted:2,reviews:2,attendanceRate:90,submissionRate:80};
const names=['Gulberg office','DHA facilities','Johar town','Model town','City hospital','Airport terminal'];
function fixture(period=7,locationId){
 const locations=names.map((name,i)=>({id:i+1,name,timezone:'Asia/Karachi'}));
 const sites=locations.filter(l=>!locationId||l.id===Number(locationId)).map((location,i)=>({...base,location,staff:8+i,attendanceRate:90,submissionRate:80,today:{...base,status:i%3===0?'ATTENTION':i%3===1?'ON_TRACK':'IN_PROGRESS'}}));
 const n=sites.length;
 return {locations,selected:sites.map(s=>s.location),days:[],asOf:'2026-10-19T07:00:00Z',date:'today',period,dateFrom:period===7?'2026-10-13':'2026-09-20',dateTo:'2026-10-19',
 summary:{...base,present:18*n,scheduledShifts:20*n,tasks:30*n,submitted:24*n,inProgress:2*n,notStarted:2*n,overdue:2*n,reviews:2*n,totalLocations:n,activeLocations:n,totalStaff:sites.reduce((sum,s)=>sum+s.staff,0),previous:{...base},attendanceChange:4.5,submissionChange:-2.1},sites,
 series:Array.from({length:period},(_,i)=>({...base,date:new Date(Date.UTC(2026,9,20-period+i)).toISOString().slice(0,10),offset:i-period+1,attendanceRate:65+(i*7)%31,submissionRate:60+(i*11)%32}))};
}
try{
 for(const [width,role] of [[1440,'ADMIN'],[390,'MANAGER']]){
 const context=await browser.newContext({viewport:{width,height:1000}}),errors=[],requests=[];
 await context.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;if(!path.startsWith('/api/'))return route.continue();let data={};
  if(path==='/api/common/get-current-user')data={id:1,companyId:1,name:'Admin',role,email:'test@example.invalid'};
  else if(path==='/api/subscription')data={company:{id:1,subscriptionStatus:'ACTIVE'},plan:{name:'Pro',limits:{locations:20,staff:200,managers:20},features:{}},usage:{}};
  else if(path==='/api/manager/operations/performance'){requests.push(url.search);data=fixture(Number(url.searchParams.get('period')||7),url.searchParams.get('locationId'));}
  else if(path.includes('count'))data={total:0};
  await route.fulfill({json:{success:true,data}});
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/dashboard');
 await page.getByRole('heading',{name:role==='ADMIN'?'Company performance':'Location performance',exact:true}).waitFor();
 await page.getByRole('heading',{name:'Every location, in focus'}).waitFor();
 assert.equal(await page.locator('.perf-location-table tbody tr').count(),6);
 assert.equal(await page.locator('.recharts-surface').count()>=3,true);
 await page.screenshot({path:`${output}/overview-${width}.png`,fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`overflow ${width}`);
 await page.getByRole('button',{name:'Last 30 days',exact:true}).click();
 await page.waitForFunction(()=>new URL(location.href).searchParams.get('period')==='30');
 await page.getByRole('heading',{name:'Every location, in focus'}).waitFor();
 assert.ok(requests.some(q=>q.includes('period=30')));
 await page.getByRole('group',{name:'Location comparison metric'}).getByRole('button',{name:'Work submitted'}).click();
 await page.getByRole('textbox',{name:'Find a location'}).fill('Airport');
 assert.equal(await page.locator('.perf-location-table tbody tr').count(),1);
 await page.getByRole('textbox',{name:'Find a location'}).fill('');
 await page.getByRole('combobox',{name:'Location',exact:true}).selectOption('1');
 await page.waitForTimeout(250);assert.ok(requests.some(q=>q.includes('locationId=1')));
 await page.getByRole('button',{name:'اردو',exact:true}).click();await page.waitForTimeout(200);
 assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`RTL overflow ${width}`);
 await page.screenshot({path:`${output}/overview-urdu-${width}.png`,fullPage:true});
 assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${width}px: charts, six locations, period and location filters, search, metric switching, Urdu, responsive overflow.`);
 }
 const context=await browser.newContext({viewport:{width:390,height:900}});
 await context.route('**/api/**',async route=>{const p=new URL(route.request().url()).pathname;if(!p.startsWith('/api/'))return route.continue();let data={};
 if(p==='/api/common/get-current-user')data={id:1,companyId:1,name:'Owner',role:'ADMIN'};
 else if(p==='/api/subscription')data={company:{subscriptionStatus:'ACTIVE'}};
 else if(p==='/api/manager/operations/performance'){data=fixture();for(const key of Object.keys(base))data.summary[key]=key.endsWith('Rate')?null:0;data.series=data.series.map(p=>({...p,attendanceRate:null,submissionRate:null}));}
 await route.fulfill({json:{success:true,data}});
 });
 const page=await context.newPage();await page.goto(origin+'/dashboard');await page.getByText('No performance data in this period',{exact:true}).waitFor();
 assert.equal(await page.locator('.perf-metric>strong').first().innerText(),'—');await page.screenshot({path:`${output}/overview-empty.png`,fullPage:true});await context.close();
 console.log('PASS empty period: no fabricated zero-rate chart.');
}finally{await browser.close();}
