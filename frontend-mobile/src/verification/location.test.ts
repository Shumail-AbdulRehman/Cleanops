import assert from 'node:assert/strict';
import test from 'node:test';
import { currentLocation } from './location';
const position=(accuracy=5,timestamp=Date.now())=>({coords:{latitude:1,longitude:2,accuracy},timestamp});
test('GPS stops its watch after a fresh accurate position, including synchronous first callback',async()=>{
 let removed=0;
 const result=await currentLocation(async next=>{next(position());return {remove(){removed++;}};},20);
 await Promise.resolve();assert.equal(result.coords.accuracy,5);assert.equal(removed,1);
});
test('GPS times out without stale coordinates and removes a late native subscription',async()=>{
 let removed=0,attach!:(value:{remove():void})=>void;
 const result=currentLocation(next=>{next(position(5,Date.now()-60000));return new Promise(resolve=>attach=resolve);},10);
 await assert.rejects(result,/Location could not be found/);
 attach({remove(){removed++;}});await Promise.resolve();assert.equal(removed,1);
});
test('GPS sends the best fresh uncertain reading for backend policy instead of hanging for accuracy',async()=>{
 let removed=0;
 const result=await currentLocation(async next=>{next(position(120));next(position(80));return {remove(){removed++;}};},10);
 assert.equal(result.coords.accuracy,80);assert.equal(removed,1);
});
test('GPS native errors give recovery guidance and clean up the subscription',async()=>{
 let removed=0;
 await assert.rejects(currentLocation(async (_next,error)=>{error('provider failed');return {remove(){removed++;}};},10),/precise location/);
 await Promise.resolve();assert.equal(removed,1);
});
