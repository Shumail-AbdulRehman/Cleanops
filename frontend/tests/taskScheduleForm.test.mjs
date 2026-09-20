import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankCreateForm, buildDateTimeIso, buildEffectiveDate, validateScheduleStep } from '../src/pages/Task/taskScheduleForm.ts';

const valid = () => ({ ...blankCreateForm(), title: '  Lobby  ', areaId:'1', effectiveDate: '2026-09-18', shiftStart: '09:00', shiftEnd: '10:00' });

test('guided schedules require one area and a nonempty mandatory subset without reference photos', () => {
  const form=valid();
  assert.equal(validateScheduleStep(form,0),null);
  form.areaId='';assert.match(validateScheduleStep(form,0),/area/);
  form.areaId='1';form.inventorySelection='SUBSET';assert.match(validateScheduleStep(form,0),/mandatory/);
  form.selectedItems=[{areaItemId:1,mandatory:true}];assert.equal(validateScheduleStep(form,0),null);
  form.selectedItems.push({areaItemId:1,mandatory:true});assert.match(validateScheduleStep(form,0),/only.*once/);
});

test('recurrence end and required times are validated before submission', () => {
  const form = valid();
  assert.equal(validateScheduleStep(form, 2), null);
  form.recurringEndDate = '2026-09-17';
  assert.match(validateScheduleStep(form, 2), /on or after/);
  form.recurringEndDate = '2026-09-19';
  assert.equal(validateScheduleStep(form, 2), null);
  form.shiftStart = '';
  assert.match(validateScheduleStep(form, 2), /start time/);
});

test('site wall times use the site time zone and date-only values keep existing UTC convention', () => {
  assert.equal(buildDateTimeIso('Asia/Karachi', '2026-09-18', '09:00'), '2026-09-18T04:00:00.000Z');
  assert.equal(buildDateTimeIso('America/Los_Angeles', '2026-09-18', '09:00'), '2026-09-18T16:00:00.000Z');
  assert.equal(buildEffectiveDate('2026-09-18').toISOString(), '2026-09-18T00:00:00.000Z');
});
