import assert from 'node:assert/strict';
import test from 'node:test';
import {registerHooks} from 'node:module';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
globalThis.React=React;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const directory=mkdtempSync(join(tmpdir(),'direct-photo-ui-'));
const intervals=new Set(),networkListeners=new Set(),appListeners=new Set();
const originalInterval=setInterval,originalClear=clearInterval;
globalThis.setInterval=callback=>{intervals.add(callback);return callback;};
globalThis.clearInterval=callback=>intervals.delete(callback);
let manifest,session,uploads,submissions,failUpload,found,deleted,resumes,activations;
let cameraPermission,permissionRequests,permissionReads,permissionReadFailure,settingsOpened,settingsFailure,sessionsOpened;
function reset(){
 const now=Date.now();resumes=0;activations=[];uploads=0;submissions=0;failUpload=true;found=null;deleted=[];
 cameraPermission={granted:true,canAskAgain:true};permissionRequests=0;permissionReads=0;permissionReadFailure=false;settingsOpened=0;settingsFailure=false;sessionsOpened=0;
 manifest={photoChecking:{available:true},allowedActions:{createSession:true,renewSession:true,reworkSession:true,retakeSlots:true,upload:true},task:{id:7,title:'Sink task',status:'IN_PROGRESS',areaNameSnapshot:'Washroom'},staffSubmittedAt:null,sequentialChecks:true,pendingJobs:0,sessions:[],items:[{id:'item',nameSnapshot:'Sink 1',typeSnapshot:'SINK',mandatory:true,requirements:[{id:'required',mandatory:true,state:'MISSING',instructionsSnapshot:'Show basin, drain and tap.',decisionVersion:0}]}]};
 session={id:'session',taskInstanceId:7,state:'ACTIVE',serverTime:new Date(now).toISOString(),clientBootId:'boot',captureExpiresAt:new Date(now+600000).toISOString(),uploadExpiresAt:new Date(now+900000).toISOString(),sequentialChecks:true,requiredContextKeys:[],slots:[{id:'slot',requirementId:'required',nonce:'nonce',sequence:0,activatedAt:new Date(now).toISOString(),expiresAt:new Date(now+90000).toISOString()}]};
}
reset();
globalThis.directUiMocks={
 rn:{View:'View',Text:'Text',Image:'Image',ScrollView:'ScrollView',Pressable:'Pressable',StyleSheet:{absoluteFill:{},create:styles=>styles},Platform:{OS:'android'},Linking:{openSettings:async()=>{settingsOpened++;if(settingsFailure)throw new Error('OS settings unavailable');}},useWindowDimensions:()=>({width:360,height:800}),AppState:{currentState:'active',addEventListener:(_name,cb)=>{appListeners.add(cb);return{remove:()=>appListeners.delete(cb)};}}},
 camera:{CameraView:'CameraView',useCameraPermissions:()=>{
  const [status,setStatus]=React.useState(cameraPermission);
  const request=React.useCallback(async()=>{permissionRequests++;setStatus({...cameraPermission});return cameraPermission;},[]);
  const read=React.useCallback(async()=>{permissionReads++;if(permissionReadFailure)throw new Error('Permission read failed');setStatus({...cameraPermission});return cameraPermission;},[]);
  return[status,request,read];
 }},
 fs:{File:class{constructor(uri){this.uri=uri;}exists=true;async bytes(){return new Uint8Array([1,2,3]);}delete(){deleted.push(this.uri);}}},
 quality:{captureClock:()=>({bootId:'boot',elapsedMs:1000}),inspectStill:async()=>({width:1800,height:1200,luminance:100,laplacianVariance:30,clipping:0})},
 api:{verificationManifest:async()=>structuredClone(manifest),openCaptureSession:async()=>{sessionsOpened++;return structuredClone(session);},activatePhoto:async(_sessionId,slotId)=>{activations.push(slotId);const slot=session.slots.find(s=>s.id===slotId);slot.activatedAt??=new Date().toISOString();return structuredClone(session);},resumeCapture:async()=>{resumes++;return structuredClone(session);},installationId:async()=> 'device',findUploadedPhoto:async()=>found,
 uploadPhoto:async()=>{uploads++;if(failUpload)throw new Error('Network error');manifest.items[0].requirements[0].state='REVIEW_REQUIRED';manifest.items[0].requirements[0].currentAttempt={id:'attempt',state:'REVIEW_REQUIRED'};session.slots[0].attemptId='attempt';return{attemptId:'attempt',state:'REVIEW_REQUIRED',storage:'cloud'};},
 finishSubmission:async()=>{submissions++;manifest.staffSubmittedAt=new Date().toISOString();return{};}},
};
const mocks={
 'react-native':'globalThis.directUiMocks.rn','expo-camera':'globalThis.directUiMocks.camera','expo-file-system':'globalThis.directUiMocks.fs',
 'expo-crypto':'{randomUUID:()=>"capture",CryptoDigestAlgorithm:{SHA256:"sha256"},digest:async()=>new Uint8Array(32)}',
 'expo-image-manipulator':'{manipulateAsync:async()=>({uri:"temporary.jpg"}),SaveFormat:{JPEG:"jpeg"}}',
 '@react-native-community/netinfo':'{addEventListener:cb=>{globalThis.directNetworkListeners.add(cb);return()=>globalThis.directNetworkListeners.delete(cb);}}',
 '@react-navigation/native':'{useIsFocused:()=>true}','react-native-safe-area-context':'{useSafeAreaInsets:()=>({bottom:24})}',
 '@tanstack/react-query':'{useQueryClient:()=>({invalidateQueries:async()=>{}})}',
 '/auth/AuthContext':'{useAuth:()=>({user:{id:1,companyId:1}})}','/i18n/LanguageProvider':'{useLanguage:()=>({t:text=>text,isRTL:false})}',
 '/verification/captureAccount':'{captureAccount:()=>"1_1"}','/verification/api':'globalThis.directUiMocks.api',
 '/modules/capture-quality':'globalThis.directUiMocks.quality','/components/ui/button':'{Button:"Button"}','/components/ui/text':'{Text:"Text"}',
 '/components/PhotoGuide':'{PhotoGuide:()=>null}',
 '/components/PhotoCaptureControls':'{CaptureFrame:"CaptureFrame",PhotoStepProgress:()=>null,CaptureBusyCard:props=>globalThis.React.createElement("Text",null,props.label),CameraRoundButton:props=>globalThis.React.createElement("Button",{onPress:props.onPress},props.label),PhotoCaptureControls:props=>globalThis.React.createElement("Button",{disabled:props.disabled||props.busy,onPress:props.onCapture},props.label),CaptureDoneCard:props=>globalThis.React.createElement("Text",null,props.label)}',
 '/components/PhotoCheckProgress':'{PhotoCheckOverlay:props=>globalThis.React.createElement("Text",null,props.check.stage)}',
 './VerificationProgress':'{VerificationProgress:()=>null}','/queries/staff':'{staffQueryKeys:{all:["staff"],tasksToday:id=>["staff",id,"tasks","today"]}}',
 // The redesigned layout parts (specs 19, 21, 23, 24, 36) are stood in by plain elements: this file proves the photo logic, not the look.
 '/components/ui/icon':'{Icon:"Icon"}',
 '/design/ActionButton':'{ActionButton:props=>globalThis.React.createElement("Button",{disabled:!!props.busy,onPress:props.onPress},props.label),ActionDock:props=>globalThis.React.createElement("View",null,props.hint,props.children),DockStatus:props=>globalThis.React.createElement("Text",null,props.label)}',
 '/design/BottomSheet':'{BottomSheet:props=>props.visible?globalThis.React.createElement("View",null,props.title,props.body,props.actions):null}',
 '/design/TopBar':'{TopBar:props=>globalThis.React.createElement("Text",null,props.title)}',
 '/design/StaffText':'{StaffText:props=>globalThis.React.createElement("Text",null,props.children),NameLine:props=>globalThis.React.createElement("Text",null,props.name),isolate:text=>text}',
 '/design/Feedback':'{Skeleton:()=>null,useSnackbar:()=>({show(){}})}',
 './SubmissionReceipt':'{SubmissionReceipt:props=>globalThis.React.createElement("SubmissionReceipt",props)}',
};
globalThis.directNetworkListeners=networkListeners;
const urls=Object.fromEntries(Object.entries(mocks).map(([name,value],i)=>{const file=join(directory,i+'.cjs');writeFileSync(file,`module.exports=${value};`);return[name,pathToFileURL(file).href];}));
const hook=registerHooks({resolve(specifier,context,next){
 if(specifier==='expo-sqlite')throw new Error('Photo flow must not open a persistent database');
 const key=Object.keys(urls).find(name=>specifier===name||name.startsWith('/')&&specifier.endsWith(name));
 return key?{url:urls[key],shortCircuit:true}:next(specifier,context);
}});
const flush=async fn=>act(async()=>{await fn?.();await Promise.resolve();});
const button=(r,name)=>r.root.findAllByType('Button').find(b=>b.props.children===name);
const click=(r,name)=>flush(()=>{const b=button(r,name);assert.ok(b,name);assert.equal(!!b.props.disabled,false,name+' enabled');return b.props.onPress();});
let Screen;
async function mount(){Screen??=(await import('../src/screens/verification/VerificationScreen.tsx')).VerificationScreen;let r;await flush(()=>{r=create(React.createElement(Screen,{route:{params:{taskId:7}},navigation:{goBack(){}}}),{createNodeMock:n=>n.type==='CameraView'?{takePictureAsync:async()=>({uri:'camera.jpg'})}:null});});return r;}
async function photograph(r){await click(r,'Next photo');await flush(()=>r.root.findByType('CameraView').props.onBarcodeScanned({data:'room-qr'}));await flush(()=>r.root.findByType('CameraView').props.onCameraReady());await click(r,'Take photo');}
test('failed upload needs manual reupload, has no automatic retry or staff exception buttons',async()=>{
 reset();let r;
 try{
  r=await mount();await photograph(r);assert.equal(uploads,1);assert.ok(button(r,'Upload again'));assert.equal(button(r,'Submit work'),undefined);
  assert.equal(/Room occupied|Ask manager|Having trouble|Retry saved|saved on this phone/i.test(JSON.stringify(r.toJSON())),false);
  await flush(()=>{for(const cb of intervals)cb();for(const cb of networkListeners)cb({isConnected:true});for(const cb of appListeners)cb('active');});
  assert.equal(uploads,1,'reconnection, foreground and timers cannot retry uploads');
  failUpload=false;await click(r,'Upload again');assert.equal(uploads,2);assert.ok(deleted.includes('temporary.jpg'));assert.ok(button(r,'Submit work'));assert.equal(resumes,0,'upload does not resume an already active session');
  await click(r,'Submit work');assert.equal(submissions,1);
 }finally{if(r)await flush(()=>r.unmount());}
});
test('lost response reconciles the existing result without another upload',async()=>{
 reset();let r;
 try{
  r=await mount();await photograph(r);found={attemptId:'attempt',state:'REVIEW_REQUIRED',storage:'cloud'};manifest.items[0].requirements[0].state='REVIEW_REQUIRED';manifest.items[0].requirements[0].currentAttempt={id:'attempt',state:'REVIEW_REQUIRED'};
  await click(r,'Upload again');assert.equal(uploads,1);assert.ok(button(r,'Submit work'));assert.equal(button(r,'Upload again'),undefined);
 }finally{if(r)await flush(()=>r.unmount());}
});
test('leaving the screen discards the temporary picture and remount cannot restore it',async()=>{
 reset();let r;
 try{
  r=await mount();await photograph(r);await flush(()=>r.unmount());r=undefined;assert.ok(deleted.includes('temporary.jpg'));
  r=await mount();assert.equal(button(r,'Upload again'),undefined);assert.ok(button(r,'Next photo'));assert.equal(uploads,1);
 }finally{if(r)await flush(()=>r.unmount());}
});
test('a checked first photo advances to the next slot without a resume request',async()=>{
 reset();failUpload=false;let r;
 manifest.items[0].requirements.push({id:'second-required',mandatory:true,state:'MISSING',instructionsSnapshot:'Show the next view.',decisionVersion:0});
 session.slots.push({id:'second-slot',requirementId:'second-required',nonce:'nonce-2',sequence:1,expiresAt:session.captureExpiresAt});
 try{
  r=await mount();await photograph(r);
  assert.equal(uploads,1);assert.equal(resumes,0);assert.equal(button(r,'Submit work'),undefined);
  // Spec 71: the camera stays open and the next slot activates with no "Next photo" tap.
  assert.equal(button(r,'Next photo'),undefined);
  assert.ok(r.root.findByType('CameraView'));assert.ok(activations.includes('second-slot'));
 }finally{if(r)await flush(()=>r.unmount());}
});
for(const [state,label] of [['CLEANING_REQUIRED','Clean, then scan QR'],['RECAPTURE_REQUIRED','Retake photo']])test(`${state} retains its QR correction action without resuming`,async()=>{
 reset();failUpload=false;let r;const original=globalThis.directUiMocks.api.uploadPhoto;
 globalThis.directUiMocks.api.uploadPhoto=async(...args)=>{const result=await original(...args);const requirement=manifest.items[0].requirements[0];requirement.state=state;requirement.currentAttempt.state=state;return{...result,state};};
 try{
  r=await mount();await photograph(r);
  assert.ok(button(r,label));assert.equal(button(r,'Next photo'),undefined);assert.equal(button(r,'Submit work'),undefined);assert.equal(resumes,0);
 }finally{globalThis.directUiMocks.api.uploadPhoto=original;if(r)await flush(()=>r.unmount());}
});
test('unqualified or missing photo capability never prompts camera or creates a session',async()=>{
 for(const qualification of [false,undefined]){
  reset();manifest.photoChecking=qualification===undefined?undefined:{available:false};let r;
  try{r=await mount();assert.equal(button(r,'Next photo'),undefined);assert.equal(r.root.findAllByType('CameraView').length,0);assert.ok(JSON.stringify(r.toJSON()).includes('Task photos are unavailable'));assert.ok(button(r,'Refresh results'));assert.equal(uploads,0);}
  finally{if(r)await flush(()=>r.unmount());}
 }
});
test('server receipt survives leaving and reloading and is not verification credit',async()=>{
 reset();manifest.staffSubmittedAt='2026-10-21T09:00:00.000Z';manifest.photoChecking={available:false};let r;
 try{
  // The receipt is SubmissionReceipt (spec 36): its "Submitted Yes" / "Verified Not yet" wording is proven in tests/screens/photoCapture.test.mjs.
  const receipt=()=>r.root.findAllByType('SubmissionReceipt')[0];
  r=await mount();assert.ok(receipt());assert.equal(receipt().props.submittedAt,'2026-10-21T09:00:00.000Z');assert.equal(receipt().props.taskId,7);assert.equal(button(r,'Submit work'),undefined);
  await flush(()=>r.unmount());r=await mount();assert.ok(receipt());assert.equal(receipt().props.submittedAt,'2026-10-21T09:00:00.000Z');assert.equal(submissions,0);}
 finally{if(r)await flush(()=>r.unmount());}
});
test('qualification changing during scanning closes camera without uploading',async()=>{
 reset();let r;
 try{
  // The dark scanner has no Refresh results button; returning to the app re-reads the server the same way (load()).
  r=await mount();await click(r,'Next photo');assert.ok(r.root.findByType('CameraView'));
  await flush(()=>{for(const cb of appListeners)cb('active');});assert.ok(r.root.findByType('CameraView'),'a re-read that keeps qualification keeps the scanner');
  manifest.photoChecking={available:false};await flush(()=>{for(const cb of appListeners)cb('active');});assert.equal(r.root.findAllByType('CameraView').length,0);assert.equal(uploads,0);}
 finally{if(r)await flush(()=>r.unmount());}
});
test('permanently denied task camera has a reachable Settings action without repeated permission prompts',async()=>{
 reset();cameraPermission={granted:false,canAskAgain:false};let r;
 try{
  r=await mount();await click(r,'Open camera settings');
  assert.equal(settingsOpened,1);assert.equal(permissionRequests,0);assert.equal(sessionsOpened,0);assert.equal(uploads,0);
  assert.equal(r.root.findAllByType('CameraView').length,0);
 }finally{if(r)await flush(()=>r.unmount());}
});
test('denied task permission can be retried explicitly and granting it still requires the task QR',async()=>{
 reset();cameraPermission={granted:false,canAskAgain:true};let r;
 try{
  r=await mount();await click(r,'Allow camera');
  assert.equal(permissionRequests,1);assert.ok(JSON.stringify(r.toJSON()).includes('Allow camera access in Settings to take task photos.'));
  assert.equal(sessionsOpened,0);assert.equal(r.root.findAllByType('CameraView').length,0);
  cameraPermission={granted:true,canAskAgain:true};await click(r,'Allow camera');
  assert.equal(permissionRequests,1,'an already granted OS permission needs no new prompt');assert.ok(r.root.findByType('CameraView'));assert.equal(sessionsOpened,0);assert.equal(uploads,0);
 }finally{if(r)await flush(()=>r.unmount());}
});
test('returning from Settings refreshes permission and server authority without opening a session or uploading',async()=>{
 reset();cameraPermission={granted:false,canAskAgain:false};let r;
 try{
  r=await mount();await click(r,'Open camera settings');
  const readsBeforeReturn=permissionReads;
  await flush(()=>{for(const cb of appListeners)cb('background');});
  cameraPermission={granted:true,canAskAgain:true};manifest.allowedActions={};
  await flush(()=>{for(const cb of appListeners)cb('active');});
  assert.equal(permissionReads,readsBeforeReturn+1);assert.equal(permissionRequests,0);assert.equal(settingsOpened,1);
  assert.equal(button(r,'Open camera settings'),undefined);assert.equal(button(r,'Next photo'),undefined);
  assert.ok(JSON.stringify(r.toJSON()).includes('Photo authority ended.'));
  assert.equal(r.root.findAllByType('CameraView').length,0);assert.equal(sessionsOpened,0);assert.equal(uploads,0);
 }finally{if(r)await flush(()=>r.unmount());}
});
test('settings failure leaves actionable guidance and never opens the task camera',async()=>{
 reset();cameraPermission={granted:false,canAskAgain:false};settingsFailure=true;let r;
 try{
  r=await mount();await click(r,'Open camera settings');
  assert.ok(JSON.stringify(r.toJSON()).includes('Open this app in your phone settings.'));
  assert.equal(permissionRequests,0);assert.equal(r.root.findAllByType('CameraView').length,0);assert.equal(sessionsOpened,0);
 }finally{if(r)await flush(()=>r.unmount());}
});
test('returning with granted permission keeps camera closed until staff explicitly continue',async()=>{
 reset();cameraPermission={granted:false,canAskAgain:false};let r;
 try{
  r=await mount();await click(r,'Open camera settings');
  const readsBeforeReturn=permissionReads;
  await flush(()=>{for(const cb of appListeners)cb('background');});
  cameraPermission={granted:true,canAskAgain:true};
  await flush(()=>{for(const cb of appListeners)cb('active');});
  assert.equal(permissionReads,readsBeforeReturn+1);assert.equal(r.root.findAllByType('CameraView').length,0);assert.equal(sessionsOpened,0);assert.equal(uploads,0);
  await click(r,'Next photo');assert.ok(r.root.findByType('CameraView'));assert.equal(sessionsOpened,0);
 }finally{if(r)await flush(()=>r.unmount());}
});
test('revoking camera permission in Settings removes the scanner and exposes recovery',async()=>{
 reset();let r;
 try{
  r=await mount();await click(r,'Next photo');
  await flush(()=>{for(const cb of appListeners)cb('background');});
  assert.equal(r.root.findAllByType('CameraView').length,0);
  cameraPermission={granted:false,canAskAgain:false};
  await flush(()=>{for(const cb of appListeners)cb('active');});
  assert.equal(r.root.findAllByType('CameraView').length,0);assert.ok(button(r,'Open camera settings'));
  assert.equal(sessionsOpened,0);assert.equal(uploads,0);
 }finally{if(r)await flush(()=>r.unmount());}
});
test('failed permission recheck pauses scanning and leaves a visible recovery message',async()=>{
 reset();let r;
 try{
  r=await mount();await click(r,'Next photo');
  await flush(()=>{for(const cb of appListeners)cb('background');});
  permissionReadFailure=true;
  await flush(()=>{for(const cb of appListeners)cb('active');});
  assert.equal(r.root.findAllByType('CameraView').length,0);
  assert.ok(JSON.stringify(r.toJSON()).includes('Camera or task access could not be checked. Refresh results and try again.'));
  assert.equal(sessionsOpened,0);assert.equal(uploads,0);
  permissionReadFailure=false;cameraPermission={granted:false,canAskAgain:false};
  await click(r,'Next photo');
  assert.equal(settingsOpened,1);assert.equal(r.root.findAllByType('CameraView').length,0);assert.equal(permissionRequests,0);
 }finally{if(r)await flush(()=>r.unmount());}
});
test.after(()=>{hook.deregister();globalThis.setInterval=originalInterval;globalThis.clearInterval=originalClear;rmSync(directory,{recursive:true,force:true});});
