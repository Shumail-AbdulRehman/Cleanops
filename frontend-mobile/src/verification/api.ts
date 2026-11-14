import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as Location from 'expo-location';
import NetInfo from '@react-native-community/netinfo';
import { client, uploadFormData, accountRequest } from '../api/client';
import type { ApiEnvelope } from '../types';
import type { CaptureSession, Manifest, CaptureMetadata, StaffAttempt } from './types';
import { captureClock } from '../../modules/capture-quality';
import { captureAccount } from './captureAccount';
const sessionRequests=new Map<string,{path:string;body:Record<string,unknown>}>();
import { createImagePart } from '../utils/upload';
import { currentLocation } from './location';
type ManifestResponse = Omit<Manifest,'items'|'session'> & {items:Array<{id:number;name:string;mandatory:boolean;state:string;itemCodeSnapshot:string;typeSnapshot:string;orderSnapshot:number;identificationSnapshot:Manifest['items'][number]['identificationSnapshot'];requirements:Array<{id:string;viewKey:string;instructions:string;mandatory:boolean;state:Manifest['items'][number]['requirements'][number]['state'];decisionVersion:number;currentAttempt?:Manifest['items'][number]['requirements'][number]['currentAttempt']}>}>};
export const verificationManifest = async (taskId:number):Promise<Manifest> => {
 const data=(await client.get<ApiEnvelope<ManifestResponse>>(`/task-instance/${taskId}/verification`)).data.data;
 return {...data,session:null,items:data.items.map(i=>({...i,id:String(i.id),nameSnapshot:i.name,requirements:i.requirements.map(r=>({...r,instructionsSnapshot:r.instructions}))}))};
};
export async function installationId() { let id=await SecureStore.getItemAsync('hygene_device_id');if(!id){id=Crypto.randomUUID();await SecureStore.setItemAsync('hygene_device_id',id);}return id; }
export async function openCaptureSession(taskId:number,areaQr:string,previousSessionId?:string,onProgress?:(message:string)=>void,reworkRequirements?:{requirementId:string;expectedGeneration:number}[]):Promise<CaptureSession> {
  const scope=captureAccount();
  if(!scope)throw new Error('Sign in again to continue your task photos.');
  const assertAccount=()=>{if(!scope||captureAccount()!==scope)throw new Error('Account changed. Sign in again to continue.');};
  assertAccount();
  const network=await NetInfo.fetch();if(network.isConnected===false || network.isInternetReachable===false)throw new Error('Connect to the internet to scan this room and start photos.');
  const clock=captureClock();const requestKey=`${scope}:${reworkRequirements?'rework':'session'}:${taskId}`;
  const pending=sessionRequests.get(requestKey);
  if(pending&&pending.body.clientBootId===clock.bootId&&pending.body.areaQr===areaQr&&JSON.stringify(pending.body.requirements??null)===JSON.stringify(reworkRequirements??null)){
    onProgress?.('Recovering your photo session…');
    try{const result=(await client.post<ApiEnvelope<CaptureSession>>(pending.path,pending.body,accountRequest(scope))).data.data;assertAccount();sessionRequests.delete(requestKey);return result;}catch(error){assertAccount();if((error as {response?:{status?:number}}).response?.status)sessionRequests.delete(requestKey);throw error;}
  }
  const permission=await Location.requestForegroundPermissionsAsync();if(!permission.granted)throw new Error('Allow location access in Settings to check this room.');
  assertAccount();
  if(!await Location.hasServicesEnabledAsync())throw new Error('Location services are off. Turn on location in Settings, then scan again.');
  onProgress?.('Checking your location…');
  const position=await currentLocation((next,error)=>Location.watchPositionAsync({accuracy:Location.Accuracy.High,timeInterval:1000,distanceInterval:0},next,error));
  assertAccount();
  const payload={...(reworkRequirements?{requirements:reworkRequirements}:{}),requestId:Crypto.randomUUID(),areaQr,deviceId:await installationId(),clientBootId:clock.bootId,clientTime:new Date().toISOString(),location:{latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy??99999,sampledAt:new Date(position.timestamp).toISOString()}};
  const path=reworkRequirements?`/task-instance/${taskId}/capture-sessions/rework`:previousSessionId?`/capture-session/${previousSessionId}/renew`:`/task-instance/${taskId}/capture-sessions`;
  sessionRequests.set(requestKey,{path,body:payload});
  assertAccount();onProgress?.('Opening your photo session…');
  try{const result=(await client.post<ApiEnvelope<CaptureSession>>(path,payload,accountRequest(scope))).data.data;assertAccount();sessionRequests.delete(requestKey);return result;}catch(error){assertAccount();if((error as {response?:{status?:number}}).response?.status)sessionRequests.delete(requestKey);throw error;}
}
export async function resumeCapture(sessionId:string,localIds:string[]) { const scope=captureAccount();if(!scope)throw new Error('Sign in again to continue.');return (await client.post<ApiEnvelope<CaptureSession>>(`/capture-session/${sessionId}/resume`,{pendingCaptureIds:localIds,clientBootId:captureClock().bootId,deviceId:await installationId()},accountRequest(scope))).data.data; }
export async function retakeSlots(sessionId:string,requirements:{requirementId:string;expectedGeneration:number}[],contexts:{contextKey:string;expectedGeneration:number}[]=[]):Promise<CaptureSession> {
  const scope=captureAccount();if(!scope)throw new Error('Sign in again to continue.');
  const slots = (await client.post<ApiEnvelope<CaptureSession['slots']>>(`/capture-session/${sessionId}/retake-slots`,{deviceId:await installationId(),requirements,contexts},accountRequest(scope))).data.data; return {slots} as CaptureSession;
}
export type PhotoUploadResult = StaffAttempt & {attemptId:string;assetId:string|null;storage?:string};
/** `onProgress` gets the share of the photo's bytes sent, 0 to 1 (spec 72); the request itself is unchanged. */
export async function uploadPhoto(metadata:CaptureMetadata,uri:string,scope:string,onProgress?:(fraction:number)=>void):Promise<PhotoUploadResult> {
  if(captureAccount()!==scope)throw new Error('Account changed. Upload stopped.');
  const result=(await uploadFormData<ApiEnvelope<PhotoUploadResult>>(`/capture-session/${metadata.sessionId}/attempts`,()=>{
    const form=new FormData();form.append('photo',createImagePart(uri,`${metadata.clientCaptureId}.jpg`,'image/jpeg'));
    for(const key of ['clientCaptureId','slotId','nonce','sha256','claimedCapturedAt','elapsedMs','bootId','deviceId'] as const)form.append(key,String(metadata[key]));
    return form;
  },120_000,()=>captureAccount()===scope,onProgress)).data;
  if(!result.attemptId)throw new Error('Photo response was incomplete. Check the result before uploading again.');
  return result;
}
export async function findUploadedPhoto(sessionId:string,clientCaptureId:string,scope:string):Promise<PhotoUploadResult|null> {
  return (await client.get<ApiEnvelope<PhotoUploadResult|null>>(`/capture-session/${sessionId}/attempts/by-capture/${clientCaptureId}`,accountRequest(scope))).data.data;
}
export async function attemptStatus(id:string,scope?:string) { return (await client.get<ApiEnvelope<{id:string;state:string;storage?:string}>>(`/verification-attempt/${id}`,scope?accountRequest(scope):undefined)).data.data; }


export async function activatePhoto(sessionId:string,slotId:string):Promise<CaptureSession>{const scope=captureAccount();if(!scope)throw new Error('Sign in again to continue.');return (await client.post<ApiEnvelope<CaptureSession>>(`/capture-session/${sessionId}/activate-photo`,{slotId,deviceId:await installationId()},accountRequest(scope))).data.data;}
export async function finishSubmission(taskId:number){const scope=captureAccount();if(!scope)throw new Error('Sign in again to continue.');return (await client.post<ApiEnvelope<{id:number;status:string;staffSubmittedAt:string}>>(`/task-instance/${taskId}/complete`,{},accountRequest(scope))).data.data;}
