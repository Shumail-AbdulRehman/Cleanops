import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.AREA_TEST_ORIGIN || 'http://127.0.0.1:5173';
const screenshots = process.env.AREA_SCREENSHOTS || '/tmp/priv-area-templates';
await mkdir(screenshots, {recursive:true});
const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try {
  for (const width of [1440,390]) {
    const context = await browser.newContext({viewport:{width,height:1000}});
    const errors=[], writes=[], qrReads=[];
    let conflict=true;
    const areas=[];
    const now=new Date(), end=new Date(+now+3600000);
    const task=(id)=>({id,title:`Cleaning task ${id}`,areaId:8,areaNameSnapshot:'East washroom',date:now.toISOString(),shiftStart:now.toISOString(),shiftEnd:end.toISOString(),status:'PENDING',isActive:true,verificationVersion:2,verificationState:'NOT_STARTED',assignments:[]});
    const site={id:7,name:'Test location',address:'Main building',latitude:'24.86',longitude:'67.00',timezone:'Asia/Karachi',radiusMeters:500,isActive:true,staff:[],taskTemplates:[],taskInstances:[task(101),task(102)]};
    await context.route(origin+'/api/**',async route=>{
      const req=route.request(), url=new URL(req.url()), path=url.pathname;
      let data={};
      if(path==='/api/common/get-current-user') data={id:1,companyId:1,role:width===390?'MANAGER':'ADMIN',name:'Demo Manager',email:'manager@test.invalid'};
      else if(path==='/api/subscription')data={company:{id:1,subscriptionStatus:'ACTIVE'},usage:{locations:1,staff:0,managers:1},plan:{name:'Pro',limits:{locations:5,staff:25,managers:3},features:{managerAccess:true}}};
      else if(path==='/api/location/7/stats')data={locationInfo:site,taskStats:[]};
      else if(path==='/api/location/'||path==='/api/location')data=[site];
      else if(path==='/api/location/7/areas'&&req.method()==='POST'){
        const body=req.postDataJSON();writes.push(body);
        let fixtureId=0;const items=body.counts.flatMap(({fixtureType,count})=>Array.from({length:count},(_,i)=>({id:++fixtureId,areaId:8,displayName:`${fixtureType==='SINK'?'Sink':'Floor zone'} ${i+1}`,fixtureType,stableCode:`${fixtureType}-${i+1}`,positionHint:null,sequence:i+1,identificationMode:'ORDERED_CONTEXT',existingNumber:null,status:'ACTIVE',rubricKey:'visible-v1',requiredViews:[{key:'whole',instructions:'Show the whole surface.'}]})));
        data={id:8,locationId:7,name:body.name,roomType:body.roomType,layoutInstructions:body.layoutInstructions,status:'ACTIVE',inventoryVersion:1,qrVersion:1,items};areas.push(data);
      }else if(path==='/api/location/7/areas')data=areas;
      else if(path==='/api/area/8'&&req.method()==='PATCH'){
        const body=req.postDataJSON();writes.push(body);
        if(conflict){conflict=false;areas[0].inventoryVersion++;return route.fulfill({status:409,json:{message:'Template changed. Review your edits.'}});}
        assert.equal(body.expectedInventoryVersion,areas[0].inventoryVersion);
        Object.assign(areas[0],body);areas[0].inventoryVersion++;data=areas[0];
      }else if(path==='/api/area/8')data=areas[0];
      else if(path==='/api/area/8/items/bulk'){
        const body=req.postDataJSON();assert.equal(body.expectedInventoryVersion,areas[0].inventoryVersion);
        areas[0].items.push({id:99,areaId:8,fixtureType:'MIRROR',displayName:'Mirror 01',stableCode:'MIRROR-01',sequence:99,status:'ACTIVE',positionHint:null,existingNumber:null,identificationMode:'ORDERED_CONTEXT',requiredViews:[{key:'whole',instructions:'Show the whole mirror.'}]});areas[0].inventoryVersion++;data=areas[0];writes.push(body);
      }else if(path==='/api/area/8/items/99'){
        const body=req.postDataJSON();assert.equal(body.expectedInventoryVersion,areas[0].inventoryVersion);Object.assign(areas[0].items.find(item=>item.id===99),body);areas[0].inventoryVersion++;data=areas[0];writes.push(body);
      }else if(/^\/api\/task-instance\/\d+\/qr$/.test(path)){
        const id=Number(path.split('/')[3]);qrReads.push(id);data={taskId:id,title:`Cleaning task ${id}`,areaName:'Renamed washroom',shiftStart:now.toISOString(),shiftEnd:end.toISOString(),timezone:'Asia/Karachi',payload:`unique-signed-task-qr-${id}`};
      }else if(path==='/api/area/migration/templates')data=[];
      else if(path==='/api/verification-exceptions/count')data={total:0};
      else if(path==='/api/manager/operations/overview')data={locations:[site],selected:[site],days:[],metrics:{},chart:{},attention:[],tasks:[],comparison:[]};
      else if(path.includes('/qr')||path.includes('fixture-labels'))throw new Error('Templates must not request QR/label credentials');
      await route.fulfill({json:{success:true,data}});
    });
    const page=await context.newPage();page.on('pageerror',err=>errors.push(err.message));
    await page.goto(origin+'/locations/7?tab=areas');
    await page.getByRole('heading',{name:'Area template',exact:true}).waitFor();
    await page.locator('section').filter({has:page.getByRole('heading',{name:'Area template',exact:true})}).getByRole('button',{name:'Add area template',exact:true}).click();
    const editor=page.locator('.area-template-editor');
    await editor.getByLabel('Area name',{exact:true}).fill('East washroom');
    await editor.getByLabel('Sink',{exact:true}).fill('1');
    await editor.getByRole('button',{name:'Create area template',exact:true}).click();
    await page.getByRole('heading',{name:'Edit area template',exact:true}).waitFor();
    assert.equal(new URL(page.url()).pathname,'/locations/7');assert.equal(areas.length,1);assert.equal(areas[0].items.length,2);
    await editor.getByLabel('Area name',{exact:true}).fill('Renamed washroom');
    await editor.getByRole('button',{name:'Save changes',exact:true}).click();
    await editor.getByRole('alert').waitFor();
    assert.equal(await editor.getByLabel('Area name',{exact:true}).inputValue(),'Renamed washroom');
    await editor.getByRole('button',{name:'Save changes',exact:true}).click();
    await editor.getByRole('status').filter({hasText:'Area template saved.'}).waitFor();
    await editor.getByRole('button',{name:'Add fixtures',exact:true}).click();
    await editor.getByLabel('Fixture type',{exact:true}).selectOption('MIRROR');
    await editor.locator('.area-template-add').getByRole('button',{name:'Add fixtures',exact:true}).click();
    await editor.getByRole('button',{name:'Edit Mirror 01',exact:true}).waitFor();
    await editor.getByRole('button',{name:'Edit Mirror 01',exact:true}).click();
    await editor.getByLabel('Fixture name',{exact:true}).fill('Entrance mirror');
    await editor.getByRole('button',{name:'Save fixture',exact:true}).click();
    await editor.getByRole('button',{name:'Edit Entrance mirror',exact:true}).waitFor();
    await page.screenshot({path:`${screenshots}/templates-${width}.png`,fullPage:true});
    assert.equal(await editor.locator('svg[role="img"]').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.goto(origin+'/areas/8');
    await page.getByRole('heading',{name:'Edit area template',exact:true}).waitFor();
    assert.equal(new URL(page.url()).pathname,'/locations/7');
    await page.goto(origin+'/locations/7?tab=instances');
    await page.getByRole('button',{name:'Task QR',exact:true}).first().click();
    const qr=page.locator('.task-qr-print');await qr.getByRole('img').waitFor();assert.equal(await qr.count(),1,'one printable QR region, without hidden mobile/desktop duplicates');
    assert.match(await qr.innerText(),/Cleaning task 101/);assert.equal(qrReads.at(-1),101);
    await page.screenshot({path:`${screenshots}/task-qr-${width}.png`,fullPage:true});
    await page.emulateMedia({media:'print'});
    assert.equal(await qr.evaluate(node=>getComputedStyle(node).visibility),'visible');
    assert.equal(await page.locator('.location-detail-page > .ops-tabs').evaluate(node=>getComputedStyle(node).visibility),'hidden');
    if(width===1440)await page.pdf({path:`${screenshots}/task-qr-print.pdf`,format:'A4'});
    await page.emulateMedia({media:'screen'});
    await page.getByRole('button',{name:'Task QR',exact:true}).last().click();
    await page.locator('.task-qr-print').getByText('Cleaning task 102',{exact:true}).waitFor();
    assert.equal(qrReads.at(-1),102);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.goto(origin+'/locations/7?tab=areas&area=8');
    await page.getByRole('heading',{name:'Edit area template',exact:true}).waitFor();
    await page.getByRole('button',{name:'اردو',exact:true}).click();
    await page.getByRole('heading',{name:'حصے کے ٹیمپلیٹ میں ترمیم',exact:true}).waitFor();
    await page.screenshot({path:`${screenshots}/templates-urdu-${width}.png`,fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);assert.equal(writes.length,5);
    console.log(`PASS ${width}px: inline creation/editing, conflict recovery, fixture addition/rename, legacy redirect, per-task QR display, Urdu and no horizontal overflow`);
    await context.close();
  }
} finally {await browser.close();}
