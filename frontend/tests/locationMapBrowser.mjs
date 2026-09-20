import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import dotenv from '../../backend/node_modules/dotenv/lib/main.js';
const root=fileURLToPath(new URL('../..', import.meta.url));
const live=process.env.MAPS_LIVE==='1';
const env=live?dotenv.parse(await readFile(root+'/backend/.env')):{};
const key=live?(env.GOOGLE_MAP_BROWSER_API_KEY||env.GOOGLE_MAP_API_KEY):'test-browser-key';
const location={id:7,name:'Blue Area Office',address:'Jinnah Avenue, Islamabad',latitude:'33.721500',longitude:'73.056000',radiusMeters:500,timezone:'Asia/Karachi',isActive:true,staff:[],taskTemplates:[],taskInstances:[],_count:{staff:0,taskTemplates:0}};
const sdk=`(()=>{const state=window.__mapsTest={}; class Map {constructor(el,o){this.center=o.center;this.handlers={};state.map=this;el.innerHTML='<div style="height:100%;background:#e8eee7;display:grid;place-items:center;color:#315c53;font:16px sans-serif">Interactive map test fixture</div>';}panTo(p){this.center=p;}setZoom(z){this.zoom=z;}getCenter(){return {toJSON:()=>this.center};}addListener(e,f){this.handlers[e]=f;return {remove(){}};}}class Marker {constructor(o){Object.assign(this,o);this.handlers={};state.marker=this;}addListener(e,f){this.handlers[e]=f;return {remove(){}};}}class Circle {constructor(o){Object.assign(this,o);state.circle=this;}setCenter(p){this.center=p;}setRadius(r){this.radius=r;}setVisible(v){this.visible=v;}setMap(m){this.map=m;}}window.google={maps:{Map,Circle,marker:{AdvancedMarkerElement:Marker,PinElement:class {constructor(){this.element=document.createElement('span');}}},places:{AutocompleteSessionToken:class {},AutocompleteSuggestion:{async fetchAutocompleteSuggestions(){if(state.failSearch)throw new Error('test failure');return {suggestions:[{placePrediction:{placeId:'test-place',text:{toString:()=> 'Centaurus Mall, Islamabad'},mainText:{toString:()=> 'Centaurus Mall'},secondaryText:{toString:()=> 'Islamabad, Pakistan'},toPlace:()=>({location:{toJSON:()=>({lat:33.7077,lng:73.0498})},formattedAddress:'Centaurus Mall, Jinnah Avenue, Islamabad',displayName:'Centaurus Mall',async fetchFields(){}})}}]};}}}}}; window.hygeneMapsReady();})();`;
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try {
 for (const mobile of (live?[false]:[false,true])) {
  const context=await browser.newContext({viewport:mobile?{width:390,height:1000}:{width:1440,height:1000}});
  const writes=[];const errors=[];
  await context.route('http://127.0.0.1:5178/api/**',async route=>{
   const request=route.request(),p=new URL(request.url()).pathname;
   let data;
   if(p==='/api/common/get-current-user')data={id:1,companyId:1,role:'ADMIN',name:'Demo Owner',email:'demo@example.test'};
   else if(p==='/api/subscription')data={company:{id:1,name:'Demo Company',subscriptionStatus:'ACTIVE'},usage:{locations:1,staff:0,managers:1},plan:{name:'Pro',limits:{locations:5,staff:25,managers:3},features:{managerAccess:true}}};
   else if(p==='/api/location/map-config')data={enabled:true,apiKey:key,mapId:env.GOOGLE_MAP_ID||'DEMO_MAP_ID'};
   else if(p==='/api/location/'&&request.method()==='POST'){writes.push(request.postDataJSON().data);data={id:8};}
   else if(p==='/api/location/7'&&request.method()==='PATCH'){writes.push(request.postDataJSON().data);data=location;}
   else if(p==='/api/location/'||p==='/api/location')data=[location];
   else if(p==='/api/location/7/stats')data={locationInfo:location,stats:{}};
   else if(p.includes('/manager/operations/overview'))data={comparison:[],locations:[],selected:[],days:[],metrics:{},chart:{},attention:[]};
   else if(p.includes('count'))data={total:0};else data={};
   await route.fulfill({json:{success:true,data}});
  });
  if(!live)await context.route('https://maps.googleapis.com/maps/api/js?**',route=>route.fulfill({contentType:'application/javascript',body:sdk}));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5178/locations'); console.log('Locations page loaded');
  await page.getByRole('button',{name:'Add location',exact:true}).first().click({timeout:10000}).catch(async e=>{console.log('Page text:',await page.locator('body').innerText());console.log('Page errors:',errors);throw e;});
  const dialog=page.getByRole('dialog');await dialog.waitFor(); console.log('Location dialog opened');
  await page.getByRole('combobox',{name:'Search for a place or address'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('[role=combobox]')?.disabled===false,{timeout:25000}).catch(async e=>{await page.screenshot({path:root+'/docs/location-map/load-debug.png'});console.log('Dialog text:', await dialog.innerText());throw e;}); console.log('Map loaded');
  await page.getByRole('combobox',{name:'Search for a place or address'}).fill('Centaurus Islamabad');
  const suggestion=page.getByRole('option').filter({hasText:'Centaurus'}).first();await suggestion.waitFor({timeout:20000});
  await page.getByRole('combobox',{name:'Search for a place or address'}).press('ArrowDown');
  await page.getByRole('combobox',{name:'Search for a place or address'}).press('Enter');
  await page.waitForFunction(()=>document.querySelector('#location-address')?.value?.includes('Islamabad'));
  await page.getByRole('button',{name:'100 m',exact:true}).click();
  if(!live){
   await page.evaluate(()=>window.__mapsTest.map.handlers.click({latLng:{toJSON:()=>({lat:33.71,lng:73.05})}}));
   await page.waitForFunction(()=>window.__mapsTest.circle.center.lat===33.71);
   await page.evaluate(()=>{const m=window.__mapsTest.marker;m.position={lat:33.715,lng:73.055};m.handlers.dragend();});
   await page.waitForFunction(()=>window.__mapsTest.circle.center.lat===33.715);
   assert.equal(await page.evaluate(()=>window.__mapsTest.circle.radius),100);
  }
  if(live)await page.waitForTimeout(1500);
  if(mobile)await dialog.evaluate(el=>{el.scrollTop=0;});
  await dialog.screenshot({path:root+'/docs/location-map/'+(live?'google-live':mobile?'mobile-fixture':'desktop-fixture')+'.png'});
  assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'dialog has no horizontal overflow');
  await page.getByRole('button',{name:'Create location',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
  assert.equal(writes.length,1);assert.equal(writes[0].radiusMeters,100);assert.ok(writes[0].address.includes('Islamabad'));
  if(!live){
   assert.equal(writes[0].latitude,'33.715000');assert.equal(writes[0].longitude,'73.055000');
   await page.goto('http://127.0.0.1:5178/locations/7?tab=staff');
   await page.getByRole('button',{name:'Location settings',exact:true}).click();
   await page.getByRole('button',{name:'Edit location',exact:true}).click();
   await page.getByRole('button',{name:'250 m',exact:true}).click();
   await page.getByRole('button',{name:'Save changes',exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
   assert.equal(writes.length,2);assert.equal(writes[1].radiusMeters,250);
   await page.goto('http://127.0.0.1:5178/locations'); console.log('Locations page loaded');
   await page.getByRole('button',{name:'Add location',exact:true}).first().click({timeout:10000}).catch(async e=>{console.log('Page text:',await page.locator('body').innerText());console.log('Page errors:',errors);throw e;});
   await page.waitForFunction(()=>!document.querySelector('[role=combobox]')?.disabled);
   await page.evaluate(()=>window.__mapsTest.failSearch=true);
   await page.getByRole('combobox',{name:'Search for a place or address'}).fill('Broken search');
   await page.getByText('Place search is unavailable. You can still select a point on the map.').waitFor();
   await page.getByText('Coordinates & timezone',{exact:true}).click();
   await page.getByLabel('Location name',{exact:true}).fill('Manual site');
   await page.getByLabel('Street address',{exact:true}).fill('Manual address');
   await page.getByLabel('Latitude',{exact:true}).fill('0');await page.getByLabel('Longitude',{exact:true}).fill('0');
   await page.getByRole('button',{name:'Create location',exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
   assert.equal(writes.length,3);assert.equal(writes[2].latitude,'0');
  }
  assert.deepEqual(errors,[]);
  console.log((live?'Live Google Maps':mobile?'Mobile browser':'Desktop browser')+': search, keyboard selection, saved coordinates and radius passed'+(!live?', click, drag, editing and manual fallback passed':''));
  await context.close();
 }
}finally{await browser.close();}
