import {getDistanceMeters} from '../../utils/geofencing.js';
import {presenceDecision,defaultVerificationPolicy,type VerificationPolicy} from './verificationPolicy.service.js';

export type PresenceLocation={latitude:number;longitude:number;radiusMeters:number};
export type PresenceSample={latitude:number;longitude:number;accuracy:number;sampledAt:string};

/** Reported GPS is a plausibility signal; uncertainty never enlarges the configured radius. */
export function evaluatePresence(location:PresenceLocation,sample:PresenceSample,policy:VerificationPolicy=defaultVerificationPolicy,now:Date=new Date()){
 const check={distance:getDistanceMeters(sample.latitude,sample.longitude,location.latitude,location.longitude),accuracy:sample.accuracy,ageSeconds:(+now-Date.parse(sample.sampledAt))/1000,radius:location.radiusMeters};
 return {check,decision:presenceDecision(check,policy)};
}
