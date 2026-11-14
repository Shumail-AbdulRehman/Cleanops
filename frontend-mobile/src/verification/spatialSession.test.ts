import {test} from 'node:test';
import assert from 'node:assert/strict';
import {beginSpatialWorld,breakSpatialContinuity,observationForCapture,spatialCaptureHint,boundedSpatialSample} from './spatialSession';
import type {SpatialSample} from './spatialTypes';
const sample:SpatialSample={tracking:'GOOD',continuity:'CONTINUOUS',nativeTimestampMs:100,camera:{position:{x:0,y:0,z:0},orientation:{x:0,y:0,z:0,w:1}},worldPoint:null};
const binding={sessionId:'session',requirementId:'requirement',contextKey:null,elapsedMs:200,capability:'LIMITED_SPATIAL' as const};
test('one world survives sequential fixture observations and records camera displacement separately',()=>{
 const cp=beginSpatialWorld('world',0);const a=observationForCapture(cp,sample,binding);
 const b=observationForCapture(a.checkpoint,{...sample,camera:{...sample.camera!,position:{x:2,y:0,z:0}}},{...binding,requirementId:'other',elapsedMs:300},a.evidence);
 assert.equal(a.evidence.worldId,b.evidence.worldId);assert.equal(b.evidence.sequence,2);assert.equal(b.evidence.movementMeters,2);assert.equal(b.evidence.worldPoint,null);
});
test('background/restart cannot silently restore continuity',()=>{
 const broken=breakSpatialContinuity(beginSpatialWorld('world',0),'BACKGROUND');
 const capture=observationForCapture(broken,sample,binding);assert.equal(capture.evidence.continuity,'BROKEN');
 const restarted=beginSpatialWorld('new-world',100,broken);assert.equal(restarted.continuity,'BROKEN');assert.notEqual(restarted.worldId,broken.worldId);
});
test('lost native continuity remains broken even when subsequent tracking is good',()=>{
 const lost=observationForCapture(beginSpatialWorld('world',0),{...sample,continuity:'BROKEN',tracking:'LOST'},binding);
 assert.equal(observationForCapture(lost.checkpoint,sample,{...binding,elapsedMs:300}).evidence.continuity,'BROKEN');
 assert.ok(spatialCaptureHint({...sample,tracking:'DEGRADED'}).includes('slowly'));assert.ok(spatialCaptureHint({...sample,continuity:'BROKEN'}).includes('wider'));
});
test('unsupported capture explicitly has unavailable tracking and no continuous AR world',()=>{
 const o=observationForCapture(beginSpatialWorld('world',0),{tracking:'UNAVAILABLE',continuity:'BROKEN',nativeTimestampMs:null,camera:null,worldPoint:null},{...binding,capability:'NO_SPATIAL'});
 assert.equal(o.evidence.continuity,'BROKEN');assert.equal(o.evidence.capability,'NO_SPATIAL');assert.equal(o.evidence.camera,null);assert.equal(o.evidence.worldPoint,null);
});

test('bad native coordinates downgrade spatial evidence without discarding the still',()=>{
 const invalid=boundedSpatialSample({...sample,camera:{...sample.camera!,position:{x:Infinity,y:0,z:0}}});assert.equal(invalid.tracking,'UNAVAILABLE');assert.equal(invalid.camera,null);
 const distant=boundedSpatialSample({...sample,worldPoint:{position:{x:30,y:0,z:0},method:'CENTER_PLANE',quality:'CANDIDATE',uncertaintyMeters:null}});assert.equal(distant.worldPoint,null);assert.equal(distant.tracking,'GOOD');
});
