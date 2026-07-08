import {expect,it} from 'vitest';
import {toiletSurfaceVariants,toiletPhotoInstruction} from './toiletViews.js';
import {fixturePresets} from './inventoryPresets.js';

it('supports both designs for legacy default toilet snapshots without changing their stored keys',()=>{
  expect(toiletSurfaceVariants('TOILET','bowl_seat',['bowl','seat'])).toEqual([
    {style:'WESTERN',surfaces:['bowl','seat']},{style:'SQUAT',surfaces:['pan','drain','footrests']},
  ]);
  expect(fixturePresets.TOILET.views.map(v=>v.key)).toEqual(['bowl_seat','exterior_base']);
  expect(fixturePresets.TOILET.views.every(v=>v.instructions.includes('Indian/squat'))).toBe(true);
});
it('does not change other fixtures or explicitly configured custom views',()=>{
  expect(toiletSurfaceVariants('SINK','basin_tap',['basin','tap'])).toBeNull();
  expect(toiletSurfaceVariants('TOILET','custom_view',['custom'])).toBeNull();
  expect(toiletPhotoInstruction('custom_view')).toBeNull();
});
