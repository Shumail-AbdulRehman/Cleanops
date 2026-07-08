import {describe,it,expect} from 'vitest';
import {defaultVerificationPolicy} from './verificationPolicy.service.js';
import {evaluatePresence} from './presence.service.js';
const now=new Date('2026-10-06T10:00:00Z');
const location={latitude:0,longitude:0,radiusMeters:100};
const sample={latitude:0,longitude:0,accuracy:10,sampledAt:now.toISOString()};
describe('session presence wrapper',()=>{
 it('accepts a fresh accurate sample fully inside the radius',()=>{expect(evaluatePresence(location,sample,undefined,now)).toMatchObject({check:{distance:0,accuracy:10,ageSeconds:0,radius:100},decision:{status:'ACCEPTABLE',reasonCode:null}});});
 it('rejects definitely outside samples',()=>{expect(evaluatePresence(location,{...sample,latitude:0.002},undefined,now).decision).toMatchObject({status:'OUTSIDE',reasonCode:'GPS_OUTSIDE'});});
 it('keeps boundary overlap uncertain without expanding radius',()=>{const result=evaluatePresence(location,{...sample,latitude:0.00085,accuracy:20},undefined,now);expect(result.decision.status).toBe('UNCERTAIN');expect(result.check.radius).toBe(100);});
 it('accepts the exact maximum sample age',()=>{expect(evaluatePresence(location,{...sample,sampledAt:new Date(+now-60000).toISOString()},undefined,now).decision.status).toBe('ACCEPTABLE');});
 it('keeps stale samples review-required',()=>{expect(evaluatePresence(location,{...sample,sampledAt:new Date(+now-60001).toISOString()},undefined,now).decision).toMatchObject({status:'UNCERTAIN',reasonCode:'GPS_STALE'});});
 it('keeps poor indoor accuracy uncertain',()=>{expect(evaluatePresence(location,{...sample,accuracy:51},undefined,now).decision).toMatchObject({status:'UNCERTAIN',reasonCode:'GPS_INACCURATE'});});
 it('keeps future or invalid sample clocks uncertain',()=>{for(const sampledAt of ['invalid',new Date(+now+1000).toISOString()])expect(evaluatePresence(location,{...sample,sampledAt},undefined,now).decision).toMatchObject({status:'UNCERTAIN',reasonCode:'GPS_UNCERTAIN'});});
 it('honors snapshotted GPS policy limits',()=>{const result=evaluatePresence(location,{...sample,accuracy:30},{...defaultVerificationPolicy,maxGpsAccuracyMeters:25},now);expect(result.decision.reasonCode).toBe('GPS_INACCURATE');});
});
