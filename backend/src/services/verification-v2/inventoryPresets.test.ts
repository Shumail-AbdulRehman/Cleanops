import {describe,it,expect} from 'vitest';
import {expandCounts,fixturePresets} from './inventoryPresets.js';
import {inventoryCountsSchema,itemEditSchema} from '../../validations/area.validation.js';
import {viewSurfaces} from './rubrics.js';
describe('stable inventory presets',()=>{
 it('expands counts into distinct fixture identities in route order',()=>{const items=expandCounts([{fixtureType:'TOILET',count:10},{fixtureType:'SINK',count:3}]);expect(new Set(items.map(i=>i.stableCode)).size).toBe(13);expect(items[9].displayName).toBe('Toilet 10');expect(items[10].sequence).toBe(11);expect(fixturePresets.TOILET.views).toHaveLength(2);});
 it('never reuses retired fixture numbering',()=>{expect(expandCounts([{fixtureType:'TOILET',count:1}],[{stableCode:'TOILET-10',sequence:15}])[0]).toMatchObject({stableCode:'TOILET-11',sequence:16});});
 it('separates toilet designs and requires only one pan photo for Indian toilets',()=>{
  const counts=inventoryCountsSchema.parse([{fixtureType:'INDIAN_TOILET',count:2},{fixtureType:'WESTERN_TOILET',count:1},{fixtureType:'SINK',count:1},{fixtureType:'MIRROR',count:1},{fixtureType:'BIN',count:1},{fixtureType:'FLOOR',count:1}]);
  const items=expandCounts(counts);
  expect(items[0]).toMatchObject({stableCode:'INDIAN_TOILET-01',displayName:'Indian toilet 01',fixtureType:'INDIAN_TOILET'});
  expect(items[0].requiredViews).toEqual([{key:'squat_pan',instructions:'Show the whole Indian toilet pan clearly.'}]);
  expect(viewSurfaces.squat_pan).toEqual(['pan']);
  expect(items[2]).toMatchObject({stableCode:'WESTERN_TOILET-01',displayName:'Western toilet 01',fixtureType:'WESTERN_TOILET'});
  expect(items[2].requiredViews.map(v=>v.key)).toEqual(['bowl_seat','exterior_base']);
 });
 it('rejects unsafe count inputs and identity rewrites',()=>{expect(()=>expandCounts([{fixtureType:'TOILET',count:-1}])).toThrow();expect(()=>expandCounts([{fixtureType:'CUSTOM',count:1}])).toThrow();expect(inventoryCountsSchema.safeParse([{fixtureType:'TOILET',count:201}]).success).toBe(false);expect(itemEditSchema.safeParse({expectedInventoryVersion:1,stableCode:'TOILET-01'}).success).toBe(false);});
});
