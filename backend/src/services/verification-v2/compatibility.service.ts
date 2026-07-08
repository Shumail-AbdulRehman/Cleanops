import type { RequestHandler } from 'express';
import { ApiError } from '../../utils/ApiError.js';
export const MINIMUM_NATIVE_VERSION='2.0.0';
export function versionSupported(value:string|undefined,minimum=MINIMUM_NATIVE_VERSION){
 const parse=(v:string)=>/^\d+\.\d+\.\d+$/.test(v)?v.split('.').map(Number):null;
 const actual=parse(value??''),required=parse(minimum);if(!actual||!required)return false;
 for(let i=0;i<3;i++){if(actual[i]!==required[i])return actual[i]!>required[i]!;}return true;
}
export function verificationCapabilities(){return {requiredWorkflowVersion:2,minimumNativeVersion:process.env.VERIFICATION_MIN_NATIVE_VERSION&&versionSupported(process.env.VERIFICATION_MIN_NATIVE_VERSION)?process.env.VERIFICATION_MIN_NATIVE_VERSION:MINIMUM_NATIVE_VERSION,nativeBuildRequired:true,legacyActiveTasksSupported:false,automaticCleanlinessPassing:false};}
export const requireNativeVerification:RequestHandler=(req,_res,next)=>{
 const caps=verificationCapabilities();
 if(req.get('X-Hygene-Workflow')!=='2'||!versionSupported(req.get('X-Hygene-App-Version'),caps.minimumNativeVersion))throw new ApiError(426,'Update the Hygene Ops Staff app to continue verification.',[{code:'NATIVE_APP_UPGRADE_REQUIRED',...caps}]);
 next();
};
