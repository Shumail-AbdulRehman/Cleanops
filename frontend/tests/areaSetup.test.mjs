import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standardPhotoMessage, roomPresets, nonRetiredFixtureCount, inventorySummary, itemEditPayload, previewInventoryCounts, validateInventorySelection } from '../src/pages/Area/types.ts';

test('count preview matches stable numbered identities and does not reuse retired codes', () => {
  const rows = previewInventoryCounts([{fixtureType:'TOILET',count:10},{fixtureType:'SINK',count:3},{fixtureType:'FLOOR',count:1}]);
  assert.equal(rows.length,14);
  assert.deepEqual(rows[9], {stableCode:'TOILET-10',displayName:'Toilet 10',sequence:10});
  assert.deepEqual(rows[10], {stableCode:'SINK-01',displayName:'Sink 01',sequence:11});
  assert.deepEqual(previewInventoryCounts([{fixtureType:'TOILET',count:1}], [{stableCode:'TOILET-10',sequence:16}])[0], {stableCode:'TOILET-11',displayName:'Toilet 11',sequence:17});
  assert.throws(() => previewInventoryCounts([{fixtureType:'SINK',count:1.5}]));
  assert.throws(() => previewInventoryCounts([{fixtureType:'SINK',count:200},{fixtureType:'BIN',count:1}]));
});
test('Indian and Western toilet counts create separate names and stable identities',()=>{
 assert.deepEqual(previewInventoryCounts([{fixtureType:'INDIAN_TOILET',count:1},{fixtureType:'WESTERN_TOILET',count:1}]),[
  {stableCode:'INDIAN_TOILET-01',displayName:'Indian toilet 01',sequence:1},
  {stableCode:'WESTERN_TOILET-01',displayName:'Western toilet 01',sequence:2},
 ]);
 assert.equal(roomPresets.WASHROOM.defaults.INDIAN_TOILET,0);
 assert.equal(roomPresets.WASHROOM.defaults.WESTERN_TOILET,0);
});
const area = {id:7,items:[{id:1,areaId:7,status:'ACTIVE',requiredViews:[{key:'a'},{key:'b'}]}, {id:2,areaId:7,status:'ACTIVE',requiredViews:[{key:'a'}]}, {id:3,areaId:7,status:'MAINTENANCE',requiredViews:[{key:'a'}]}]};
test('ALL optional overrides include future fixtures; SUBSET preserves saved selection', () => {
  const optional = [{areaItemId:2,mandatory:false}];
  assert.deepEqual(inventorySummary(area,'ALL',optional), {total:2,mandatory:1,optional:1,requiredViews:2});
  assert.equal(validateInventorySelection(area,'ALL',[{areaItemId:1,mandatory:false},...optional]),'Choose at least one mandatory item.');
  assert.deepEqual(inventorySummary(area,'SUBSET',[{areaItemId:1,mandatory:true}]), {total:1,mandatory:1,optional:0,requiredViews:2});
  assert.match(validateInventorySelection(area,'SUBSET',[{areaItemId:3,mandatory:true}]), /active/);
});
test('fixture retirement payload excludes immutable and unsupported API fields', () => {
  const payload=itemEditPayload({id:1,areaId:7,stableCode:'TOILET-01',displayName:' Toilet 01 ',sequence:2,positionHint:null,identificationMode:'PRINTED_LABEL',existingNumber:'old',status:'RETIRED',rubricKey:'toilet',requiredViews:[]},4);
  assert.deepEqual(payload,{displayName:'Toilet 01',sequence:2,positionHint:null,identificationMode:'PRINTED_LABEL',existingNumber:null,status:'RETIRED',expectedInventoryVersion:4});
});

test('inventory review rejects foreign items even when their IDs appear in the list', () => {
  const mixed = {id:7,items:[...area.items,{id:9,areaId:8,status:'ACTIVE',requiredViews:[]}]};
  assert.match(validateInventorySelection(mixed,'SUBSET',[{areaItemId:9,mandatory:true}]),/this area only/);
});

test('required photo summary excludes optional views and optional fixtures', () => {
  const inventory = {items:[{id:1,status:'ACTIVE',requiredViews:[{key:'default'},{key:'required',mandatory:true},{key:'optional',mandatory:false}]},{id:2,status:'ACTIVE',requiredViews:[{key:'optional-fixture'}]}]};
  assert.equal(inventorySummary(inventory,'ALL',[{areaItemId:2,mandatory:false}]).requiredViews,2);
  assert.equal(inventorySummary(inventory,'SUBSET',[{areaItemId:1,mandatory:true}]).requiredViews,2);
});

test('area list excludes retired fixtures even when total row count includes them', () => {
  assert.equal(nonRetiredFixtureCount({items:[{status:'ACTIVE'},{status:'MAINTENANCE'},{status:'RETIRED'}],_count:{items:3}}),2);
});
test('room presets provide categories and editable defaults without assuming fixture counts', () => {
  assert.deepEqual(roomPresets.WASHROOM.fixtureTypes,['INDIAN_TOILET','WESTERN_TOILET','SINK','MIRROR','BIN','FLOOR']);
  assert.deepEqual(roomPresets.GENERAL.fixtureTypes,['BIN','FLOOR']);
  assert.equal(roomPresets.WASHROOM.defaults.TOILET,0);
  assert.equal(roomPresets.WASHROOM.defaults.FLOOR,1);
});

test('standard photos render pending or restricted states until explicitly safe', () => {
  assert.equal(standardPhotoMessage('PENDING'),'Photo saved. Privacy review pending.');
  assert.equal(standardPhotoMessage(undefined),'Photo saved. Privacy review pending.');
  assert.equal(standardPhotoMessage('HOLD'),'Photo restricted for privacy review.');
  assert.equal(standardPhotoMessage('SAFE'),null);
});

test('mandatory fixtures with only optional views cannot activate a selection', () => {
  const inventory = {id:7,items:[{id:1,areaId:7,status:'ACTIVE',requiredViews:[{key:'optional',mandatory:false}]}]};
  assert.match(validateInventorySelection(inventory,'ALL',[]),/mandatory view/);
  assert.match(validateInventorySelection(inventory,'SUBSET',[{areaItemId:1,mandatory:true}]),/mandatory view/);
});
