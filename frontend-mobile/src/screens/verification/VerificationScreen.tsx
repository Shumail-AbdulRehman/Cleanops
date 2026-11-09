import { photoAuthority, photoResultAction, reconcileSubmission } from "../../launch/recoveryPolicy";
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as Crypto from 'expo-crypto';
import NetInfo from '@react-native-community/netinfo';
import { captureClock, inspectStill } from '../../../modules/capture-quality';
import { useAuth } from '../../auth/AuthContext';
import { useLanguage } from '../../i18n/LanguageProvider';
import { PhotoGuide } from '../../components/PhotoGuide';
import { CameraRoundButton, CaptureBusyCard, CaptureDoneCard, CaptureFrame, PhotoCaptureControls, PhotoStepProgress, type PhotoSegment } from '../../components/PhotoCaptureControls';
import { PhotoCheckOverlay } from '../../components/PhotoCheckProgress';
import { Icon, type LucideIconName } from '../../components/ui/icon';
import { ActionButton, ActionDock, DockStatus } from '../../design/ActionButton';
import { BottomSheet, type SheetGlyphTone } from '../../design/BottomSheet';
import { Skeleton, useSnackbar } from '../../design/Feedback';
import { NameLine, StaffText, isolate } from '../../design/StaffText';
import { TopBar } from '../../design/TopBar';
import { countdown } from '../../design/format';
import { colors, radius, space, type ColorToken } from '../../design/tokens';
import { translateText } from '../../i18n/translations';
import { stackRoutes, tabRoutes } from '../../navigation/routeNames';
import type { MobileTaskPage } from '../../queries/mobileWork';
import { assessmentDetail, photoStatuses, type PhotoStatus } from '../../verification/presentation';
import { nextPhotoAction, photoRow, type PhotoAction } from '../../verification/photoRowState';
import { SubmissionReceipt } from './SubmissionReceipt';
import { captureAccount } from '../../verification/captureAccount';
import { activatePhoto, finishSubmission, findUploadedPhoto, installationId, openCaptureSession, uploadPhoto, verificationManifest, type PhotoUploadResult } from '../../verification/api';
import { captureAllowed, checkedPhotoState, mergeManifest, nextSlot, objectSecondsRemaining } from '../../verification/policy';
import { qualityInstruction, reworkRequirements, slotInstruction } from '../../verification/capturePolicy';
import { photoCorrection, requiredPhotoIds } from '../../verification/feedback';
import { checkAt, checkOutcome, withUploadProgress, type PhotoCheck } from '../../verification/photoCheck';
import { VerificationProgress } from './VerificationProgress';
import { staffQueryKeys } from '../../queries/staff';
import type { CaptureMetadata, LocalSession, Manifest, RequirementState } from '../../verification/types';
import type { RootStackParamList } from '../../types';

type Props=NativeStackScreenProps<RootStackParamList,'Verification'>;
type Mode='prepare'|'scan'|'locating'|'capture'|'progress';
type PendingPhoto={metadata:CaptureMetadata;uri:string};
const scanSettings={barcodeTypes:['qr' as const]};
const messageFor=(error:unknown)=>error instanceof Error?error.message:'Could not finish. Please try again.';
const removeTemporary=(uri:string)=>{try{const file=new File(uri);if(file.exists)file.delete();}catch{/* Do not hide the upload result. */}};
const UPLOAD_UNAVAILABLE='Photo upload is unavailable. Check the result before retrying. Your received photos are kept.';
/** Results that need nothing from the person: the camera stays open for the next photo. */
const ON_CAMERA_STATES=['PASSED','REVIEW_REQUIRED','PRIVACY_HOLD'];
/** Android back-camera picture size for task photos: undefined until the scanner asks once, null when none fits (full size, as before). */
let chosenPictureSize:string|null|undefined;

/**
 * The smallest 4:3 size whose long side is at least 1800 (so the 1800 px upload is never enlarged)
 * and that is at most about 3.2 MP. Null when the list is missing or nothing fits.
 */
export function photoPictureSize(sizes:unknown):string|null {
  if(!Array.isArray(sizes))return null;
  const fits=sizes.flatMap(size=>{
    const match=typeof size==='string'?/^(\d+)x(\d+)$/.exec(size):null;if(!match)return [];
    const long=Math.max(+match[1],+match[2]),short=Math.min(+match[1],+match[2]);
    return short>0&&long>=1800&&long*short<=3_200_000&&Math.abs(long/short-4/3)<.02?[{size,pixels:long*short}]:[];
  });
  return fits.sort((a,b)=>a.pixels-b.pixels)[0]?.size??null;
}

/**
 * The local session after an upload whose result needs nothing from the person, built from the upload
 * response alone. Null when the response cannot say (another state, no requirement, unknown requirement):
 * the caller then reads the manifest as before.
 */
function withPhotoResult(local:LocalSession,metadata:CaptureMetadata,result:PhotoUploadResult):LocalSession|null {
  if(!metadata.requirementId||!result.attemptId||!ON_CAMERA_STATES.includes(result.state))return null;
  const {attemptId,assetId:_asset,storage:_storage,...attempt}=result;
  let found=false;
  const items=local.manifest.items.map(item=>({...item,requirements:item.requirements.map(r=>{
    if(r.id!==metadata.requirementId)return r;
    found=true;
    return {...r,state:result.state as RequirementState,cleanlinessOutcome:result.cleanlinessOutcome??null,reviewReason:result.reviewReason??null,currentAttempt:{...attempt,id:attemptId}};
  })}));
  if(!found)return null;
  return {...local,manifest:{...local.manifest,items},session:{...local.session,slots:local.session.slots.map(s=>s.id===metadata.slotId?{...s,attemptId}:s)}};
}

export function VerificationScreen({route,navigation}:Props) {
  const {user}=useAuth(),{t,language}=useLanguage();
  const taskId=route.params.taskId,scope=user?`${user.companyId}_${user.id}`:null;
  const queryClient=useQueryClient(),insets=useSafeAreaInsets(),focused=useIsFocused();
  const [permission,requestPermission,getPermission]=useCameraPermissions();
  const [manifest,setManifest]=useState<Manifest|null>(null),[local,setLocal]=useState<LocalSession|null>(null);
  const [mode,setMode]=useState<Mode>('prepare'),[pending,setPending]=useState<PendingPhoto|null>(null);
  const pendingRef=useRef<PendingPhoto|null>(null);
  const [busy,setBusy]=useState(false),[busyLabel,setBusyLabel]=useState('Please wait…');
  const [message,setMessage]=useState(''),[refreshing,setRefreshing]=useState(false);
  const [online,setOnline]=useState(true),[foreground,setForeground]=useState(AppState.currentState==='active');
  const [cameraReady,setCameraReady]=useState(false),[cameraKey,setCameraKey]=useState(0),[torch,setTorch]=useState(false);
  const [lastUpdated,setLastUpdated]=useState<number|null>(null),[seconds,setSeconds]=useState<number|null>(null);
  const camera=useRef<CameraView>(null),mounted=useRef(true),inFlight=useRef(false),loading=useRef(false),activation=useRef<string|null>(null);
  const openedSession=useRef<{taskId:number;scope:string;id:string}|null>(null);
  // After a failed scan the scanner stays paused until the person taps Scan again, so the QR still in view cannot retrigger it.
  const scanHeldRef=useRef(false),[scanHeld,setScanHeld]=useState(false);
  // A new photo's first send keeps the camera open; `done` names the item just confirmed over the camera.
  const [sending,setSending]=useState(false),[done,setDone]=useState<string|null>(null),[capturePictureSize,setCapturePictureSize]=useState<string|undefined>(undefined);
  // Spec 72: the stage of the photo being checked, moved only by the real work; shown while that work is busy.
  const [check,setCheck]=useState<PhotoCheck|null>(null),checkCount=useRef(0);
  const holdScan=(held:boolean)=>{scanHeldRef.current=held;if(mounted.current)setScanHeld(held);};
  const {width,height}=useWindowDimensions();
  const cameraHeight=Math.max(220,Math.min(420,(width-40)*1.25,height*.48));
  const valid=()=>mounted.current&&scope!==null&&captureAccount()===scope;
  const rememberPending=(photo:PendingPhoto|null)=>{pendingRef.current=photo;if(mounted.current)setPending(photo);};
  const authority=photoAuthority(manifest);
  const finished=!!manifest&&(!!manifest.staffSubmittedAt||manifest.task.status==='COMPLETED');
  const required=manifest?requiredPhotoIds(manifest):new Set<string>();
  const mandatory=manifest?.items.flatMap(i=>i.requirements).filter(r=>required.has(r.id))??[];
  const canSubmit=!pending&&!finished&&mandatory.length>0&&mandatory.every(r=>checkedPhotoState(r.state)&&(r.state==='WAIVED'||!!r.currentAttempt));
  const dirty=mandatory.some(r=>r.state==='CLEANING_REQUIRED'),retake=mandatory.some(r=>r.state==='RECAPTURE_REQUIRED');
  const slot=local?nextSlot(local,[]):undefined,heading=local&&slot?slotInstruction(local,slot):null;
  const slotActive=!!slot&&(!local?.session.sequentialChecks||!!slot.activatedAt);
  let allowed=false;try{allowed=!!local&&captureAllowed(local,captureClock())&&seconds!==0;}catch{/* Scan QR to establish the native clock. */}
  const load=useCallback(async()=>{
    if(loading.current)return null;loading.current=true;setRefreshing(true);
    try{
      const current=await verificationManifest(taskId);
      if(!mounted.current||captureAccount()!==scope)return null;
      setManifest(current);setLastUpdated(Date.now());setLocal(previous=>previous?mergeManifest(previous,current):null);return current;
    }finally{loading.current=false;if(mounted.current)setRefreshing(false);}
  },[taskId,scope]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;if(pendingRef.current)removeTemporary(pendingRef.current.uri);pendingRef.current=null;};},[]);
  useEffect(()=>{if(focused)void load().catch(error=>{if(mounted.current)setMessage(messageFor(error));});},[load,focused]);
  useEffect(()=>NetInfo.addEventListener(state=>setOnline(state.isConnected!==false&&state.isInternetReachable!==false)),[]);
  useEffect(()=>{
    const listener=AppState.addEventListener('change',state=>{
      setForeground(state==='active');setCameraReady(false);
      if(state==='active'){
        // Settings can change OS permission, but never renew task authority.
        void Promise.all([getPermission(),load()]).catch(()=>{
          if(valid()){setMode('prepare');setMessage('Camera or task access could not be checked. Refresh results and try again.');}
        });
      }
    });
    return()=>listener.remove();
  },[getPermission,load]);
  useEffect(()=>{setCameraReady(false);},[mode,focused,cameraKey]);
  useEffect(()=>{
    const tick=()=>{try{setSeconds(local?objectSecondsRemaining(local,slot,captureClock()):null);}catch{setSeconds(0);}};
    tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer);
  },[local,slot?.id,slot?.activatedAt]);
  useEffect(()=>{if(!busy)setCheck(null);},[busy]);
  useEffect(()=>{if(done===null)return;const timer=setTimeout(()=>setDone(null),1600);return()=>clearTimeout(timer);},[done]);
  useEffect(()=>{
    // The item timer starts only once the camera can take the photo, so camera start-up never uses it.
    if(!authority.capture||!local||!slot||slotActive||pending||busy||!cameraReady||mode!=='capture'||activation.current===slot.id)return;
    activation.current=slot.id;let live=true;
    void activatePhoto(local.session.id,slot.id).then(response=>{
      if(!live||!valid())return;
      setLocal(previous=>previous&&previous.session.id===local.session.id?{...previous,session:{...previous.session,...response,serverTime:previous.session.serverTime}}:previous);
    }).catch(error=>{if(live&&valid()){setMessage(messageFor(error));setMode('progress');}}).finally(()=>{activation.current=null;});
    return()=>{live=false;};
  },[local?.session.id,slot?.id,slotActive,pending,busy,cameraReady,mode,authority.capture]);
  async function action(work:()=>Promise<void>,label='Please wait…') {
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setBusyLabel(label);setMessage('');
    try{await work();}catch(error){if(valid())setMessage(messageFor(error));}
    finally{inFlight.current=false;if(mounted.current)setBusy(false);}
  }
  async function beginPhotos(){await action(async()=>{
    const current=await load();
    if(!photoAuthority(current).capture)throw new Error('Task photos are unavailable. Your received results are kept. Ask your manager for help.');
    if(Platform.OS==='web')throw new Error('Open the installed staff app to scan the task QR and take photos.');
    if(!online)throw new Error('Internet needed to continue. Reconnect, then scan this task’s QR code.');
    const currentPermission=await getPermission();
    if(!valid())return;
    if(!currentPermission.granted&&currentPermission.canAskAgain===false){
      try{await Linking.openSettings();}catch{throw new Error('Open this app in your phone settings.');}
      return;
    }
    const result=currentPermission.granted?currentPermission:await requestPermission();
    if(!result.granted)throw new Error('Allow camera access in Settings to take task photos.');
    holdScan(false);setMode('scan');
  });}
  async function scanned(qr:string){await action(async()=>{let opened=false;try{
    const current=await load();
    if(!current||!photoAuthority(current).capture)throw new Error('Task photos are unavailable. Your received results are kept. Ask your manager for help.');
    if(!online)throw new Error('Internet needed to confirm the room. Reconnect, then scan this task’s QR code.');
    setMode('locating');
    const targets=current.items.flatMap(i=>i.requirements).filter(r=>r.state==='CLEANING_REQUIRED').map(r=>({requirementId:r.id,expectedGeneration:r.decisionVersion}));
    const remembered=openedSession.current;
    const previousSessionId=remembered?.taskId===taskId&&remembered.scope===scope?remembered.id
      :local?.session.id??current.sessions?.find(s=>s.state==='ACTIVE'||s.state==='PAUSED')?.id;
    const session=await openCaptureSession(taskId,qr,previousSessionId,label=>{if(valid())setBusyLabel(label);},targets.length?targets:undefined);
    if(!scope||!valid())return;
    // Renew this session on retry even if the follow-up read cannot finish setting up the camera.
    openedSession.current={taskId,scope,id:session.id};
    const updated=await verificationManifest(taskId),clock=captureClock();
    if(!valid())return;
    if(pendingRef.current){removeTemporary(pendingRef.current.uri);rememberPending(null);}
    setLocal({session,manifest:updated,anchorElapsedMs:clock.elapsedMs,anchorBootId:clock.bootId,savedAt:Date.now(),paused:false});
    openedSession.current=null;
    setCapturePictureSize(chosenPictureSize??undefined);setManifest(updated);setLastUpdated(Date.now());setMode('capture');opened=true;
  }finally{if(!opened)holdScan(true);}});if(mounted.current)setMode(previous=>previous==='locating'?'scan':previous);}
  async function refreshAfterUpload(){
    // The manifest supplies current results and session state. Uploading does
    // not pause the session; the next activation returns fresh slot authority.
    await load();
    if(valid())setMode('progress');
  }
  async function sendPhoto(photo:PendingPhoto,checkFirst=false){
    if(!scope||!valid())throw new Error('Sign in again to upload photos.');
    if(!online)throw new Error('Upload failed. Reconnect, then tap Upload again.');
    setBusyLabel('Uploading and checking photo…');
    if(checkFirst){
      const existing=await findUploadedPhoto(photo.metadata.sessionId,photo.metadata.clientCaptureId,scope);
      if(photoResultAction(existing?.state)==='received'){
        removeTemporary(photo.uri);rememberPending(null);await refreshAfterUpload();return;
      }
      if(photoResultAction(existing?.state)==='checking'){
        setMessage('This photo is still being checked. Tap Check result shortly.');return;
      }
    }
    // Same-capture result lookup remains available even when new processing is unavailable. Upload again
    // re-reads authority first; a new photo goes straight to the server, which checks authority itself.
    if(checkFirst&&!photoAuthority(await load()).upload)throw new Error(UPLOAD_UNAVAILABLE);
    let result:PhotoUploadResult;
    const progress=checkFirst?undefined:(fraction:number)=>{if(mounted.current)setCheck(current=>withUploadProgress(current,fraction,Date.now()));};
    try{result=await uploadPhoto(photo.metadata,photo.uri,scope,progress);}
    catch(error){
      // The server refused: read authority once so the message says when uploads are closed.
      if(!checkFirst&&(error as {response?:{status?:number}}).response?.status&&valid()){
        const current=await load().catch(()=>null);
        if(current&&!photoAuthority(current).upload)throw new Error(UPLOAD_UNAVAILABLE);
      }
      throw error;
    }
    if(!valid()){removeTemporary(photo.uri);return;}
    removeTemporary(photo.uri);rememberPending(null);
    if(!checkFirst)setCheck(current=>checkAt(current,checkOutcome(result.state),Date.now()));
    if(checkFirst||!stayOnCamera(photo.metadata,result))await refreshAfterUpload();
  }
  /** After a new photo that needs nothing more: update from the response, confirm over the camera, keep it open. */
  function stayOnCamera(metadata:CaptureMetadata,result:PhotoUploadResult){
    if(!local||local.session.id!==metadata.sessionId)return false;
    const next=withPhotoResult(local,metadata,result);
    let open=false;try{open=!!next&&!!nextSlot(next,[])&&captureAllowed(next,captureClock());}catch{/* Read the manifest instead. */}
    if(!next||!open)return false;
    setLocal(next);setManifest(next.manifest);
    setDone(next.manifest.items.find(i=>i.requirements.some(r=>r.id===metadata.requirementId))?.nameSnapshot??'');
    return true;
  }
  const learnPictureSize=()=>{
    if(Platform.OS!=='android'||chosenPictureSize!==undefined)return;
    chosenPictureSize=null;
    void Promise.resolve(camera.current?.getAvailablePictureSizesAsync?.()).then(sizes=>{chosenPictureSize=photoPictureSize(sizes);}).catch(()=>{/* Keep the full-size picture. */});
  };
  async function capture(){await action(async()=>{
    if(!authority.capture||!local||!slot||!slotActive||!allowed||!cameraReady||!focused||!foreground||pending||!scope)throw new Error('Scan this task’s QR code again to continue taking photos.');
    if(!online)throw new Error('Internet needed to upload. Reconnect before taking the photo.');
    setDone(null);setCheck({id:++checkCount.current,stage:'quality',since:Date.now(),fraction:0});
    const session=local,clock=captureClock();
    const photo=await camera.current?.takePictureAsync({quality:.9,skipProcessing:false});
    if(!photo)throw new Error('Camera did not save a photo. Try again.');
    let resized:string|undefined;
    try{
      if(!valid())return;
      // Same 1800 px long side and JPEG 0.85 as before; the check then reads this small file, not the original.
      const result=await manipulateAsync(photo.uri,[photo.width>=photo.height?{resize:{width:1800}}:{resize:{height:1800}}],{compress:.85,format:SaveFormat.JPEG});resized=result.uri;
      const inspected=await inspectStill(resized);
      // The size rule keeps reading the camera's own picture, so a small picture never passes by being enlarged.
      const quality=photo.width>0&&photo.height>0?{...inspected,width:photo.width,height:photo.height}:inspected;
      const correction=qualityInstruction(quality);
      if(correction)throw new Error(correction);
      const bytes=await new File(resized).bytes(),hash=await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256,bytes);
      if(!valid()||!captureAllowed(session,captureClock()))throw new Error('Photo window ended. Scan this task’s QR code again before taking another photo.');
      const metadata:CaptureMetadata={taskId,sessionId:session.session.id,slotId:slot.id,nonce:slot.nonce,clientCaptureId:Crypto.randomUUID(),sha256:Array.from(new Uint8Array(hash)).map(v=>v.toString(16).padStart(2,'0')).join(''),claimedCapturedAt:new Date(Date.parse(session.session.serverTime)+clock.elapsedMs-session.anchorElapsedMs).toISOString(),elapsedMs:clock.elapsedMs-session.anchorElapsedMs+Math.max(0,Date.parse(session.session.serverTime)-Date.parse(session.session.serverTimeAnchor??session.session.serverTime)),bootId:clock.bootId,deviceId:await installationId(),requirementId:slot.requirementId,qualityResult:quality};
      const next={metadata,uri:resized};rememberPending(next);resized=undefined;setSending(true);setCheck(current=>checkAt(current,'upload',Date.now()));
      try{await sendPhoto(next);}catch(error){if(valid()){setMode('progress');setMessage(`${t(messageFor(error))} ${t('Upload again to continue. If you close this screen, take a new photo.')}`);}}
      finally{if(mounted.current)setSending(false);}
    }finally{removeTemporary(photo.uri);if(resized)removeTemporary(resized);}
  },'Preparing photo…');}
  async function checkResult(){await action(async()=>{
    if(!pending||!scope)return;
    const result=await findUploadedPhoto(pending.metadata.sessionId,pending.metadata.clientCaptureId,scope);
    if(photoResultAction(result?.state)==='received'){
      removeTemporary(pending.uri);rememberPending(null);await refreshAfterUpload();
    }else setMessage(result?.state==='SERVICE_FAILURE'?'Photo checking could not finish. Check availability before retrying this same photo.':result&&result.state!=='RESERVED'?'This photo is still being checked. Check again shortly.':'The photo has not finished uploading. Tap Upload again.');
  },'Checking photo result…');}
  async function submit(){await action(async()=>{await reconcileSubmission(()=>verificationManifest(taskId),()=>finishSubmission(taskId));await load();await queryClient.invalidateQueries({queryKey:staffQueryKeys.all});},'Submitting work…');}
  const cameraVisible=authority.capture&&!finished&&(!pending||sending)&&focused&&foreground&&permission?.granted&&['scan','capture'].includes(mode);
  // Layout only from here: display values and press wiring. No state, effect or rule is added or changed.
  const photos=manifest?listedPhotos(manifest,local,required):[];
  const continuePhotos=()=>{if(mode==='progress'&&slot&&allowed&&!dirty&&!retake)setMode('capture');else void beginPhotos();};
  const uploadAgain=()=>action(async()=>{if(pending)await sendPhoto(pending,true);});
  const refresh=()=>void action(async()=>{await load();});
  const back=()=>{if(!busy)navigation.goBack();};
  const toList=()=>setMode('progress');
  const scanAgain=()=>{if(inFlight.current)return;setMessage('');holdScan(false);};
  const permissionLabel=!finished&&authority.capture&&!permission?.granted?(permission?.canAskAgain===false?'Open camera settings':'Allow camera'):null;
  const area=manifest?.task.areaNameSnapshot??manifest?.area?.name??manifest?.task.title??'';
  const cameraNode=cameraVisible?<CameraView key={cameraKey} ref={camera} style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} pictureSize={mode==='capture'?capturePictureSize:undefined} onCameraReady={()=>{setCameraReady(true);if(mode==='scan')learnPictureSize();}} onMountError={()=>{setCameraReady(false);setMessage('Camera could not open. Tap Restart camera.');}} barcodeScannerSettings={mode==='scan'&&!scanHeld?scanSettings:undefined} onBarcodeScanned={mode==='scan'&&!scanHeld?({data})=>{if(!inFlight.current&&!scanHeldRef.current&&focused&&foreground&&online)void scanned(data);}:undefined}/>:null;
  const dark=authority.capture&&!finished&&(!pending||sending)&&(mode==='scan'||mode==='capture');
  const cameraTools={torch,cameraVisible:!!cameraVisible,onTorch:()=>setTorch(value=>!value),onRestart:()=>setCameraKey(value=>value+1)};
  const permissionButton=permissionLabel&&online?<ActionButton kind={dark?'next':'outline'} icon="Camera" label={permissionLabel} busy={busy} onPress={()=>void beginPhotos()}/>:null;
  return <View style={styles.flex}>
    <StackHeaderHidden navigation={navigation}/>
    <PhotoResults busy={busy} pending={!!pending} pendingId={pending?.metadata.requirementId??null} message={message} mode={mode} manifest={manifest}
      onRetake={continuePhotos} onNext={()=>{if(mode==='progress'&&slot&&allowed&&!dirty&&!retake)setMode('capture');}} onUploadAgain={uploadAgain}>
      {watch=>finished&&manifest?.staffSubmittedAt?<View style={[styles.white,{paddingTop:insets.top}]}>
        <SubmissionReceipt taskId={taskId} areaName={area} submittedAt={manifest.staffSubmittedAt} timeZone={manifest.task.location?.timezone}
          photosReceived={mandatory.filter(r=>r.state!=='MISSING').length} photosRequired={mandatory.length}
          hasNextTask={hasNextTask(queryClient.getQueryData?.(staffQueryKeys.tasksToday(user?.id)) as InfiniteData<MobileTaskPage>|undefined,taskId)}
          onNext={()=>navigation.popTo(stackRoutes.staffTabs,{screen:tabRoutes.myDay})} onDone={()=>navigation.popTo(stackRoutes.staffTabs,{screen:tabRoutes.myDay})}/>
      </View>
      :mode==='locating'?<View style={styles.night}><CaptureBusyCard label={busyLabel} centred/></View>
      :dark&&mode==='scan'?<ScanView area={area} camera={cameraNode} {...cameraTools} busy={busy} busyLabel={busyLabel} message={message} online={online}
        permissionGranted={!!permission?.granted} permissionButton={permissionButton} held={scanHeld} onScanAgain={scanAgain} onClose={toList}/>
      :dark&&mode==='capture'?<CaptureView camera={cameraNode} {...cameraTools} busy={busy} busyLabel={busyLabel} message={message} online={online}
        permissionButton={permissionButton} heading={heading} local={local} slotRequirementId={slot?.requirementId??null} slotContextKey={slot?.contextKey??null}
        photos={photos} seconds={seconds} done={done} check={check} onClose={toList}
        shutter={slot&&allowed?<PhotoCaptureControls disabled={!cameraReady||!slotActive||!online} busy={busy} label={busy?busyLabel:'Take photo'} onCapture={()=>watch(slot.requirementId??null,capture())}/>
          :!busy?<ActionButton kind="next" icon="QrCode" label={slot?'Scan task QR to renew photo window':'View photo results'} onPress={()=>void (slot?beginPhotos():action(async()=>{await load();setMode('progress');}))}/>:null}/>
      :pending?<WhitePage onBack={back} dock={<ActionDock withSafeArea>
          {!online?<DockStatus label="Internet needed to continue" icon="WifiOff"/>
            :!authority.upload?<DockStatus label="Photo upload is unavailable. Check the result before retrying. Your received photos are kept." icon="CloudOff"/>
            :<View style={styles.stack}>
              <ActionButton kind="next" icon="CloudUpload" label="Upload again" busy={busy} onPress={()=>watch(pending.metadata.requirementId??null,uploadAgain())}/>
              <StaffText role="meta" color="muted" align="center">This photo is saved on your phone and has not uploaded yet.</StaffText>
            </View>}
        </ActionDock>}>
        <View style={styles.pending}>
          <Image source={{uri:pending.uri}} style={styles.preview} resizeMode="contain" accessibilityIgnoresInvertColors/>
          <StaffText role="sectionTitle" accessibilityRole="header" accessibilityLiveRegion="polite">{busy?'Uploading and checking photo…':'Upload this photo again'}</StaffText>
          {message?<StaffText role="body" accessibilityLiveRegion="polite">{message}</StaffText>:null}
          <StaffText role="meta" color="muted">This picture is temporary. If you close this screen, take it again.</StaffText>
          {online?<ActionButton kind="outline" icon="RefreshCw" label="Check result" onPress={()=>watch(pending.metadata.requirementId??null,checkResult())}/>:null}
          {online?<ActionButton kind="ghost" label="Refresh results" busy={refreshing} onPress={refresh}/>:null}
        </View>
      </WhitePage>
      :<WhitePage onBack={back} dock={<ListDock hasManifest={!!manifest} canSubmit={canSubmit} canCapture={authority.capture&&!finished} online={online} busy={busy}
          action={nextPhotoAction(photos).action} onSubmit={()=>void submit()} onContinue={continuePhotos}/>}>
        {message?<Note tone="warn" icon="CircleAlert" body={message}/>:null}
        {!finished&&!authority.capture?<Note tone="bad" icon="CircleAlert" title="Task photos are unavailable"
          body={authority.qualified?'Photo authority ended. Refresh results and ask your manager about the task window.':'Your received results are kept. Ask your manager for help. Refresh results to check availability.'}/>:null}
        {!manifest?<View style={styles.loading} accessibilityLabel={t('Load task photos')} testID="photo-list-loading">
          {refreshing?<><Skeleton height={32} width="60%"/><Skeleton height={20} width="40%"/><Skeleton height={76}/><Skeleton height={76}/></>:null}
          <ActionButton kind="outline" label="Load task photos" busy={refreshing} onPress={refresh}/>
        </View>
        :<VerificationProgress manifest={manifest} local={local} rows={[]} online={online} lastUpdated={lastUpdated} onSelect={authority.capture&&!finished?()=>continuePhotos():undefined}/>}
        <View style={styles.listActions}>
          {permissionButton}
          {online?<ActionButton kind="ghost" icon="RefreshCw" label="Refresh results" busy={refreshing} onPress={refresh}/>:null}
        </View>
      </WhitePage>}
    </PhotoResults>
  </View>;
}

const informational=(text:string)=>text.startsWith('This photo is still being checked')||text.startsWith('Photo checking could not finish');

/** The same required-photo list the photo list (spec 35) shows, in the same order. */
function listedPhotos(manifest:Manifest,local:LocalSession|null,required:Set<string>):PhotoStatus[] {
  return photoStatuses(manifest,local,[]).filter(p=>required.has(p.key)||p.key==='ENTRANCE'||p.key==='LAYOUT');
}

/** True when today's cached task feed still has another task that is not started or not finished. */
function hasNextTask(data:InfiniteData<MobileTaskPage>|undefined,taskId:number):boolean {
  return (data?.pages??[]).flatMap(page=>page.tasks??[]).some(task=>task.id!==taskId&&(task.status==='PENDING'||task.status==='IN_PROGRESS'));
}

/** The screen draws its own top: the white top bar or the dark camera overlay. */
function StackHeaderHidden({navigation}:{navigation:{setOptions?:(options:{headerShown:boolean})=>void}}) {
  useEffect(()=>{navigation.setOptions?.({headerShown:false});},[navigation]);
  return null;
}

type ResultKind='retake'|'clean'|'review'|'fail'|'upload';
type Watch=(requirementId:string|null,work:Promise<unknown>)=>void;
const resultSheets:Record<ResultKind,{glyph:LucideIconName;tone:SheetGlyphTone;title:string;body?:string;action:string;icon:LucideIconName;warn:boolean}>={
  retake:{glyph:'Camera',tone:'needsYou',title:'Take this photo again',action:'Retake photo',icon:'Camera',warn:true},
  clean:{glyph:'Droplets',tone:'needsYou',title:'This still needs cleaning',body:'Clean this again. Then scan the task QR to take a new photo.',action:'Clean, then scan QR',icon:'QrCode',warn:true},
  review:{glyph:'Hourglass',tone:'blue',title:'Waiting for manager review',body:'Your photo is kept. Continue with the next photo.',action:'Next photo',icon:'Camera',warn:false},
  fail:{glyph:'Info',tone:'blue',title:'Photo check could not finish',body:'This does not mean it is dirty. Your photo is kept for your manager.',action:'Next photo',icon:'Camera',warn:false},
  upload:{glyph:'CloudUpload',tone:'red',title:'Photo did not upload',body:'Check your internet and upload again. If you close this screen, take a new photo.',action:'Upload again',icon:'CloudUpload',warn:true},
};

/**
 * Reads the outcome of a photo the person just sent (shutter, Upload again, Check result) once that
 * work has finished and the screen holds the server's answer, and shows it: a sheet when the result
 * needs the person, the "Photo uploaded" message bar otherwise. Display only; it decides nothing.
 */
function PhotoResults({busy,pending,pendingId,message,mode,manifest,onRetake,onNext,onUploadAgain,children}:{
  busy:boolean;pending:boolean;pendingId:string|null;message:string;mode:string;manifest:Manifest|null;
  onRetake:()=>void;onNext:()=>void;onUploadAgain:()=>Promise<unknown>;children:(watch:Watch)=>ReactNode;
}) {
  const {t}=useLanguage();
  const {show}=useSnackbar();
  const [settled,setSettled]=useState<{id:string|null}|null>(null);
  const [sheet,setSheet]=useState<{kind:ResultKind;correction?:string}|null>(null);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const watch=useCallback<Watch>((requirementId,work)=>{
    const done=()=>{if(alive.current)setSettled({id:requirementId});};
    void work.then(done,done);
  },[]);
  useEffect(()=>{
    if(!settled||busy)return;
    setSettled(null);
    if(pending){if(message&&!informational(message))setSheet({kind:'upload'});return;}
    if(message||mode!=='progress'||!manifest)return;
    const requirement=settled.id?manifest.items.flatMap(item=>item.requirements).find(r=>r.id===settled.id):undefined;
    const kind=requirement?photoRow(requirement.state).kind:'uploaded';
    if(requirement&&kind==='retake')setSheet({kind:'retake',correction:photoCorrection(assessmentDetail(requirement),t)});
    else if(kind==='clean')setSheet({kind:'clean'});
    else if(requirement?.state==='SERVICE_FAILURE')setSheet({kind:'fail'});
    else if(kind==='review')setSheet({kind:'review'});
    else show('Photo uploaded');
  },[settled,busy]);
  const close=()=>setSheet(null);
  const look=sheet?resultSheets[sheet.kind]:null;
  const act=()=>{
    const kind=sheet?.kind;close();
    if(kind==='retake')onRetake();
    else if(kind==='review'||kind==='fail')onNext();
    else if(kind==='upload')watch(pendingId,onUploadAgain());
  };
  return <>
    {children(watch)}
    <BottomSheet visible={!!look} onDismiss={close} glyph={look?.glyph} glyphTone={look?.tone} title={look?.title??''} haptic={look?.warn?'warning':undefined}
      body={sheet?.kind==='retake'?(sheet.correction?<StaffText role="body" color="muted" translate={false}>{sheet.correction}</StaffText>:undefined):look?.body}
      actions={look?<ActionButton kind="next" icon={look.icon} label={look.action} onPress={act}/>:null}/>
  </>;
}

function WhitePage({onBack,dock,children}:{onBack:()=>void;dock?:ReactNode;children:ReactNode}) {
  return <View style={styles.white}>
    <TopBar title="Task photos" backLabel="Back to tasks" onBack={onBack} withSafeArea/>
    <ScrollView style={styles.flex} contentContainerStyle={styles.listBody}>{children}</ScrollView>
    {dock??null}
  </View>;
}

/** The progress list's one action, from `nextPhotoAction`; Submit only when the screen's own rule allows it. */
function ListDock({hasManifest,canSubmit,canCapture,online,busy,action,onSubmit,onContinue}:{
  hasManifest:boolean;canSubmit:boolean;canCapture:boolean;online:boolean;busy:boolean;action:PhotoAction;onSubmit:()=>void;onContinue:()=>void;
}) {
  if(!hasManifest||(!canSubmit&&!canCapture))return null;
  if(!online)return <ActionDock withSafeArea><DockStatus label="Internet needed to continue" icon="WifiOff"/></ActionDock>;
  if(canSubmit)return <ActionDock withSafeArea hint="Your work is ready to submit. Manager review may still be needed.">
    <ActionButton kind="next" icon="Check" label="Submit work" busy={busy} onPress={onSubmit}/>
  </ActionDock>;
  if(action==='waitUpload')return <ActionDock withSafeArea><DockStatus label="Waiting for the upload to finish" icon="CloudUpload"/></ActionDock>;
  const look:{label:string;icon:LucideIconName}=action==='clean'?{label:'Clean, then scan QR',icon:'QrCode'}
    :action==='retake'?{label:'Retake photo',icon:'Camera'}
    :action==='uploadAgain'?{label:'Upload again',icon:'CloudUpload'}
    :{label:'Next photo',icon:'Camera'};
  return <ActionDock withSafeArea><ActionButton kind="next" icon={look.icon} label={look.label} busy={busy} onPress={onContinue}/></ActionDock>;
}

function Note({tone,icon,title,body}:{tone:'warn'|'bad';icon:LucideIconName;title?:string;body:string}) {
  const {isRTL}=useLanguage();
  const ink:ColorToken=tone==='bad'?'bad':'warn';
  return <View style={[styles.note,{backgroundColor:colors[tone==='bad'?'badWash':'warnWash'],flexDirection:isRTL?'row-reverse':'row'}]}>
    <Icon name={icon} size={22} color={colors[ink]}/>
    <View style={styles.flex}>
      {title?<StaffText role="rowTitle" color={ink}>{title}</StaffText>:null}
      <StaffText role="body" color={tone==='bad'?'ink':ink} accessibilityLiveRegion="polite">{body}</StaffText>
    </View>
  </View>;
}

type CameraTools={torch:boolean;cameraVisible:boolean;onTorch:()=>void;onRestart:()=>void};

function TorchButton({torch,onTorch}:Pick<CameraTools,'torch'|'onTorch'>) {
  const {t}=useLanguage();
  return <CameraRoundButton label={t(torch?'Torch off':'Torch on')} on={torch} onPress={onTorch}>
    <Icon name="Flashlight" size={22} color={torch?colors.ink:colors.surface}/>
  </CameraRoundButton>;
}

/** English: one sentence with the area isolated. Urdu: the label line, then the area on its own line. */
function AreaLine({area}:{area:string}) {
  const {language,t}=useLanguage();
  if(!area)return null;
  if(language==='ur')return <><StaffText role="body" color="onCamera">Find the code for this task:</StaffText><NameLine role="body" color="onCamera" name={area}/></>;
  return <StaffText role="body" color="onCamera" translate={false}>{t('Find the code for {area}.',{area:isolate(area)})}</StaffText>;
}

/** Dark scanner for the photo QR: same look as the start scanner (spec 34). */
function ScanView({area,camera,torch,cameraVisible,onTorch,onRestart,busy,busyLabel,message,online,permissionGranted,permissionButton,held,onScanAgain,onClose}:CameraTools&{
  area:string;camera:ReactNode;busy:boolean;busyLabel:string;message:string;online:boolean;permissionGranted:boolean;permissionButton:ReactNode;
  held:boolean;onScanAgain:()=>void;onClose:()=>void;
}) {
  const {t,isRTL}=useLanguage();
  const insets=useSafeAreaInsets();
  const row=isRTL?'row-reverse':'row';
  return <View style={styles.night}>
    <View style={styles.camera}>
      {camera}
      <View style={[styles.cameraTop,{paddingTop:insets.top+6}]}>
        <View style={[styles.topRow,{flexDirection:row}]}>
          <CameraRoundButton label={t('Back')} onPress={onClose}>
            <View style={isRTL?styles.mirror:null}><Icon name="ArrowLeft" size={24} color={colors.surface}/></View>
          </CameraRoundButton>
          <View style={styles.flex}/>
          {cameraVisible?<TorchButton torch={torch} onTorch={onTorch}/>:null}
        </View>
        <StaffText role="cameraTitle" color="surface" accessibilityRole="header">Scan the same QR</StaffText>
        <AreaLine area={area}/>
      </View>
      <CaptureFrame/>
      {busy?<CaptureBusyCard label={busyLabel}/>:null}
    </View>
    <View style={[styles.bar,{paddingBottom:insets.bottom+12}]}>
      {held?<>
        <StaffText role="body" color="onCamera" align="center" accessibilityLiveRegion="polite">{message||'The scan did not finish. Tap Scan again to try once more.'}</StaffText>
        <ActionButton kind="next" icon="QrCode" label="Scan again" busy={busy} onPress={onScanAgain}/>
      </>:<>
      {message?<StaffText role="body" color="onCamera" align="center" accessibilityLiveRegion="polite">{message}</StaffText>:null}
      {!permissionGranted?<>
        <StaffText role="body" color="onCamera" align="center">Allow camera access to scan the task QR code.</StaffText>
        {permissionButton}
      </>:!online?<StaffText role="body" color="onCamera" align="center" accessibilityLiveRegion="polite">Internet needed to continue</StaffText>
      :<>
        <StaffText role="body" color="onCamera" align="center">Hold the QR inside the frame. It scans by itself.</StaffText>
        {cameraVisible&&!busy?<Pressable accessibilityRole="button" accessibilityLabel={t('Restart camera')} onPress={onRestart} style={[styles.ghost,{flexDirection:row}]}>
          <Icon name="RotateCcw" size={20} color={colors.surface}/>
          <StaffText role="groupTitle" color="surface">Restart camera</StaffText>
        </Pressable>:null}
      </>}
      </>}
    </View>
  </View>;
}

/** Dark full-screen task camera with the photo's position, title, instruction, photo window and shutter. */
function CaptureView({camera,torch,cameraVisible,onTorch,onRestart,busy,busyLabel,message,online,permissionButton,heading,local,slotRequirementId,slotContextKey,photos,seconds,done,check,onClose,shutter}:CameraTools&{
  camera:ReactNode;busy:boolean;busyLabel:string;message:string;online:boolean;permissionButton:ReactNode;
  heading:{title:string;view:string;hint:string}|null;local:LocalSession|null;slotRequirementId:string|null;slotContextKey:string|null;
  photos:PhotoStatus[];seconds:number|null;done:string|null;check:PhotoCheck|null;onClose:()=>void;shutter:ReactNode;
}) {
  const {t,isRTL,language}=useLanguage();
  const insets=useSafeAreaInsets();
  const row=isRTL?'row-reverse':'row';
  const item=local?.manifest.items.find(i=>i.requirements.some(r=>r.id===slotRequirementId));
  const currentKey=slotRequirementId??slotContextKey;
  const index=photos.findIndex(p=>p.key===currentKey);
  const segments:PhotoSegment[]=photos.map((p,i)=>photoRow(p.state).done?'done':i===index?'current':'todo');
  const name=heading?(slotContextKey||!item?t(heading.title):translateText(item.nameSnapshot,language)):'';
  const instruction=message||(heading?.hint?t(heading.hint):'');
  return <View style={styles.night}>
    <View style={styles.camera}>
      {camera}
      {heading?<PhotoGuide fixture={item?.typeSnapshot} instruction={heading.view}/>:null}
      <View style={[styles.cameraTop,{paddingTop:insets.top+6}]}>
        <View style={[styles.topRow,{flexDirection:row}]}>
          <CameraRoundButton label={t('Close')} onPress={onClose}><Icon name="X" size={24} color={colors.surface}/></CameraRoundButton>
          {photos.length?<PhotoStepProgress current={index>=0?index+1:1} total={photos.length} segments={segments}/>:<View style={styles.flex}/>}
        </View>
        {heading?<StaffText role="cameraTitle" color="surface" accessibilityRole="header" translate={false}>{`${name}: ${t(heading.view)}`}</StaffText>:null}
        {instruction?<StaffText role="body" color="onCamera" accessibilityLiveRegion="polite" translate={false}>{instruction}</StaffText>:null}
        {seconds!==null?<View style={[styles.window,{flexDirection:row}]}>
          <Icon name="Timer" size={17} color={colors.yellow}/>
          <View style={styles.flex}><StaffText role="label" color="surface" translate={false}>{t('{time} left. After that, scan the task QR again.',{time:isolate(countdown(seconds))})}</StaffText></View>
        </View>:null}
      </View>
      {busy?(check?<PhotoCheckOverlay check={check}/>:<CaptureBusyCard label={busyLabel}/>):done!==null?<CaptureDoneCard label={done?t('{item} photo done',{item:isolate(translateText(done,language))}):t('Photo uploaded')}/>:null}
    </View>
    <View style={[styles.bar,{paddingBottom:insets.bottom+12}]}>
      <StaffText role="meta" color="onCamera" align="center">Keep people out of the photo, including in mirrors.</StaffText>
      {!online?<StaffText role="body" color="onCamera" align="center" accessibilityLiveRegion="polite">Internet needed to continue</StaffText>:null}
      {permissionButton}
      {shutter?<View style={[styles.shoot,{flexDirection:row}]}>
        <View style={styles.side}>{cameraVisible?<TorchButton torch={torch} onTorch={onTorch}/>:null}</View>
        {shutter}
        <View style={styles.side}>{cameraVisible?<CameraRoundButton label={t('Restart camera')} onPress={onRestart}><Icon name="RotateCcw" size={22} color={colors.surface}/></CameraRoundButton>:null}</View>
      </View>:null}
    </View>
  </View>;
}

const styles=StyleSheet.create({
  flex:{flex:1},
  mirror:{transform:[{scaleX:-1}]},
  white:{flex:1,backgroundColor:colors.surface},
  night:{flex:1,backgroundColor:colors.night},
  listBody:{paddingBottom:24,gap:12},
  listActions:{paddingHorizontal:space.gutter,gap:8},
  loading:{padding:space.gutter,gap:12},
  stack:{gap:8},
  note:{marginHorizontal:space.gutter,marginTop:8,gap:12,paddingVertical:14,paddingHorizontal:16,borderRadius:radius.cardRadius,alignItems:'flex-start'},
  pending:{paddingHorizontal:space.gutter,paddingTop:8,gap:12},
  preview:{width:'100%',height:220,borderRadius:radius.cardRadius,backgroundColor:colors.canvas},
  camera:{flex:1,overflow:'hidden',backgroundColor:colors.night},
  cameraTop:{paddingHorizontal:16,paddingBottom:12,gap:4},
  topRow:{minHeight:space.touchMinIcon,alignItems:'center',gap:12,marginBottom:6},
  window:{alignItems:'center',gap:8,marginTop:4},
  bar:{backgroundColor:colors.night,paddingTop:14,paddingHorizontal:22,gap:12},
  ghost:{minHeight:space.ghostHeight,alignItems:'center',justifyContent:'center',gap:10,borderRadius:radius.actionRadius},
  shoot:{alignItems:'center',justifyContent:'space-between'},
  side:{width:space.touchMinIcon,height:space.touchMinIcon,alignItems:'center',justifyContent:'center'},
});
