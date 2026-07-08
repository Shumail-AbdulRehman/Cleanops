import { describe,it,expect } from 'vitest';
import { performanceRate,performanceWindows,performanceQuery,summarizePerformance,type PerformanceRow } from './companyPerformance.service.js';
const locations=[{id:1,name:'Large site',timezone:'Asia/Karachi'},{id:2,name:'Small site',timezone:'America/New_York'}];
const row=(extra:Partial<PerformanceRow>):PerformanceRow=>({locationId:1,offset:0,staff:10,scheduledShifts:0,present:0,late:0,missing:0,tasks:0,submitted:0,verified:0,accepted:0,inProgress:0,overdue:0,notStarted:0,reviews:0,...extra});
describe('company performance reporting',()=>{
  it('weights attendance and submission by records instead of averaging location percentages',()=>{
    const result=summarizePerformance(locations,[row({scheduledShifts:10,present:10,tasks:10,submitted:10}),row({locationId:2,staff:1,scheduledShifts:1,tasks:1})],7);
    expect(result.summary.attendanceRate).toBe(90.9);expect(result.summary.submissionRate).toBe(90.9);
    expect(result.summary.totalStaff).toBe(11);expect(result.summary.totalLocations).toBe(2);
  });
  it('distinguishes missing data from a measured zero and computes percentage point changes',()=>{
    expect(performanceRate(0,0)).toBeNull();expect(performanceRate(0,5)).toBe(0);
    const result=summarizePerformance(locations,[row({offset:-7,scheduledShifts:10,present:5}),row({scheduledShifts:10,present:8})],7);
    expect(result.summary.attendanceChange).toBe(30);expect(result.summary.submissionChange).toBeNull();
    expect(result.series).toHaveLength(7);expect(result.series[0]!.attendanceRate).toBeNull();
    expect(result.sites[1]!.today.status).toBe('NO_ACTIVITY');
  });
  it('includes all locations and keeps historical period totals separate from selected-day alerts',()=>{
    const sites=Array.from({length:8},(_,id)=>({id,name:`Site ${id}`,timezone:'UTC'}));
    const result=summarizePerformance(sites,[row({locationId:1,offset:-2,overdue:3,tasks:3}),row({locationId:2,missing:1})],7);
    expect(result.sites).toHaveLength(8);expect(result.sites[1]!.today.status).toBe('NO_ACTIVITY');
    expect(result.sites[2]!.today.status).toBe('ATTENTION');
  });
  it('uses adjacent non-overlapping location-local days across DST',()=>{
    const windows=performanceWindows([locations[1]!],'2026-11-02',7,new Date('2026-11-02T20:00:00Z'));
    expect(windows).toHaveLength(14);
    const dst=windows.find(w=>w.localDate==='2026-11-01')!;
    expect(+dst.end-+dst.start).toBe(25*3600000);
    for(let i=1;i<windows.length;i++)expect(+windows[i-1]!.end).toBe(+windows[i]!.start);
    expect(windows.at(-1)!.offset).toBe(0);
    expect(performanceQuery.safeParse({period:365}).success).toBe(false);
    expect(performanceQuery.safeParse({period:['7','30']}).success).toBe(false);
  });
});
