import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../../utils/ApiError.js';
type QrArea={id:number;qrVersion:number;qrNonce:string};
function key(kind:'qr'|'slot') {const value=process.env[kind==='qr'?'VERIFICATION_QR_SECRET':'VERIFICATION_SLOT_SECRET'];if(!value||value.length<32) throw new ApiError(503,'Verification signing key requires at least 32 characters');return value;}
const keyId=()=>process.env.VERIFICATION_QR_KEY_ID??'v1';
const mac=(value:string,kind:'qr'|'slot')=>createHmac('sha256',key(kind)).update(value).digest('base64url');
function sign(area:QrArea,itemId?:number) {const body=Buffer.from(JSON.stringify({namespace:'hygeneops.area.v2',kid:keyId(),areaId:area.id,version:area.qrVersion,nonce:area.qrNonce,...(itemId?{itemId}:{})})).toString('base64url');return `${body}.${mac(body,'qr')}`;}
export const signAreaQr=(area:QrArea)=>sign(area);
export const signFixtureQr=(area:QrArea,itemId:number)=>sign(area,itemId);
export function verifyAreaQr(payload:string,area:QrArea) {
 const [body,signature,...rest]=payload.split('.');if(!body||!signature||rest.length) throw new ApiError(422,'Invalid area QR');
 const expected=mac(body,'qr');if(signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected))) throw new ApiError(422,'Invalid area QR');
 let data:any;try{data=JSON.parse(Buffer.from(body,'base64url').toString());}catch{throw new ApiError(422,'Invalid area QR');}
 if(data.namespace!=='hygeneops.area.v2'||data.kid!==keyId()||data.areaId!==area.id||data.version!==area.qrVersion||data.nonce!==area.qrNonce||data.itemId) throw new ApiError(422,'Scan the current QR for this area');
 return data;
}
export const slotNonce=(sessionId:string,slotId:string,generation:number)=>mac(`${sessionId}:${slotId}:${generation}`,'slot');
export const hashNonce=(nonce:string)=>createHash('sha256').update(nonce).digest('hex');

// A template can be reused by many tasks. Only a code signed for this exact
// task instance grants scan authority; area and fixture codes cannot substitute.
type QrTask = {id:number;areaId:number|null};
export function signTaskQr(task:QrTask,area:QrArea) {
 if(task.areaId!==area.id)throw new ApiError(409,'Task area does not match its template');
 const body=Buffer.from(JSON.stringify({namespace:'hygeneops.task.v1',kid:keyId(),taskId:task.id,areaId:area.id,version:area.qrVersion,nonce:area.qrNonce})).toString('base64url');
 return `${body}.${mac(body,'qr')}`;
}
export function verifyTaskQr(payload:string,task:QrTask,area:QrArea) {
 const expected=signTaskQr(task,area);
 if(Buffer.byteLength(payload)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(payload),Buffer.from(expected)))
  throw new ApiError(422,'Scan the QR code generated for this task');
 return {taskId:task.id,areaId:area.id};
}
