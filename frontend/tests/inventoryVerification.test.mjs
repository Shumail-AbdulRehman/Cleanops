import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateInventorySelection } from '../src/pages/Area/types.ts';
import { verificationLabel, timingLabel } from '../src/pages/Verification/presentation.ts';
const area = { id: 7, items: [{id: 1, areaId: 7, status:'ACTIVE', requiredViews:[{key:'required'}]}, {id: 2, areaId: 7, status:'RETIRED'}] };
test('task selections reject another area, retired items, duplicates and empty mandatory sets', () => {
  assert.equal(validateInventorySelection(area, 'ALL', []), null);
  assert.match(validateInventorySelection(area, 'SUBSET', [{areaItemId: 2, mandatory:true}]), /active items/);
  assert.match(validateInventorySelection(area, 'SUBSET', [{areaItemId: 99, mandatory:true}]), /this area only/);
  assert.match(validateInventorySelection(area, 'SUBSET', [{areaItemId: 1, mandatory:true},{areaItemId: 1, mandatory:true}]), /once/);
  assert.match(validateInventorySelection(area, 'SUBSET', [{areaItemId: 1, mandatory:false}]), /mandatory/);
});
test('manual and verified completion have distinct labels and processing has neutral timing', () => {
  assert.equal(verificationLabel({completionOutcome:'COMPLETED_WITH_EXCEPTIONS'}), 'Completed with exceptions');
  assert.equal(verificationLabel({completionOutcome:'VERIFIED_COMPLETE'}), 'Verified complete');
  assert.equal(verificationLabel({verificationState:'PROCESSING'}), 'Waiting for checks');
  assert.equal(timingLabel('UNCERTAIN'), 'Capture timing needs review');
});
