import {describe,it,expect} from 'vitest';
import {fromZonedTime} from 'date-fns-tz';
import {resolveTaskInstanceWindow} from './taskInstanceWindow.js';
describe('scheduling characterization',()=>{
 it('anchors an overnight task to local calendar time',()=>{const zone='Asia/Karachi';const result=resolveTaskInstanceWindow({baseDate:fromZonedTime('2026-10-04T00:00:00',zone),taskShiftStart:fromZonedTime('2026-01-01T22:00:00',zone),taskShiftEnd:fromZonedTime('2026-01-02T02:00:00',zone),timeZone:zone});expect(result.shiftStart.toISOString()).toBe('2026-10-04T17:00:00.000Z');expect(result.shiftEnd.toISOString()).toBe('2026-10-04T21:00:00.000Z');});
 it('projects clock times across DST without fixed UTC offsets',()=>{const zone='America/New_York';const result=resolveTaskInstanceWindow({baseDate:fromZonedTime('2026-03-08T00:00:00',zone),taskShiftStart:fromZonedTime('2026-01-01T09:00:00',zone),taskShiftEnd:fromZonedTime('2026-01-01T10:00:00',zone),timeZone:zone});expect(result.shiftStart.toISOString()).toBe('2026-03-08T13:00:00.000Z');});
});
