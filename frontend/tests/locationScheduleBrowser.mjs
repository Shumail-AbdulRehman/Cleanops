// React Compiler regression on the actual page; all API responses are fixtures.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_CORE_PATH??'playwright-core');
const origin=process.env.SCHEDULE_BROWSER_URL??'http://127.0.0.1:5173';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const user={id:1,companyId:1,role:'MANAGER',name:'Fixture manager',email:'fixture@example.invalid'};
const location={id:28,name:'Fixture site',address:'Fixture address',latitude:'0',longitude:'0',timezone:'Asia/Karachi',radiusMeters:100,isActive:true,staff:[],taskTemplates:[],taskInstances:[]};
const item={key:'fixture',kind:'planned',instanceId:null,templateId:1,title:'Morning sink cleaning',startsAt:'2026-10-05T03:00:00Z',endsAt:'2026-10-05T04:00:00Z',status:null,staff:null,staffMeaning:'unassigned',continuesFromPreviousDay:false,continuesIntoNextDay:false};
const schedule={location,weekStart:'2026-10-05',weekEndExclusive:'2026-10-12',asOf:'2026-10-07T00:00:00Z',days:Array.from({length:7},(_,i)=>({date:`2026-10-${String(5+i).padStart(2,'0')}`,items:i===0?[item]:[]}))};
try{
 for(const scenario of ['success','error']){
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  let release;const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(!path.startsWith('/api/'))return route.continue();
   if(path==='/api/location/28/schedule'){
    await gate;return route.fulfill(scenario==='success'?{json:{success:true,data:schedule}}:{status:500,json:{message:'Synthetic failure'}});
   }
   const data=path.endsWith('/common/get-current-user')?user:path==='/api/location/28/stats'?{locationInfo:location,taskStats:[]}:path==='/api/verification-exceptions'?{cases:[],total:0,unreadCount:0,nextCursor:null}:[];
   return route.fulfill({json:{success:true,data}});
  });
  await page.goto(origin+'/locations/28?tab=schedule');
  await page.getByRole('status').filter({hasText:'Loading weekly schedule'}).waitFor({timeout:10000}).catch(async error=>{console.error({errors:errors.slice(0,5),body:await page.locator('body').innerText()});throw error;});
  assert.deepEqual(errors,[],'Loading must not read missing schedule data');release();
  if(scenario==='success'){
   const task=page.getByRole('button',{name:/Morning sink cleaning/});await task.waitFor();
   assert.match(await task.innerText(),/08:00 – 09:00/,'Use site timezone after data arrives');
   await task.click();await page.getByRole('dialog').waitFor();assert.match(await page.getByRole('dialog').innerText(),/Fixture site · Asia\/Karachi/);
  }else await page.getByRole('alert').filter({hasText:'We couldn’t load this week'}).waitFor();
  assert.deepEqual(errors,[],scenario+' must not crash');await page.close();
 }
 console.log('PASS: compiled schedule loading, resolved site-time display/dialog and API error state (fixtures).');
}finally{await browser.close();}
