import {it,expect} from 'vitest';
import {spatialEvaluation} from './spatialEvaluation.js';
it('missing dataset produces null rates, not fabricated successful results',()=>{const report=spatialEvaluation([]);expect(report.status).toBe('DATASET_UNAVAILABLE');expect(report.overall.sameFixtureDetectionRate).toBeNull();expect(report.autoIdentityAcceptance).toBe(false);});
it('reports same detection, false same, tracking failure and uncertainty separately by device/OS',()=>{
 const base={device:'device',os:'os',scenario:'identical stalls',tracking:'GOOD',coverage:'MATCH',duplicate:'NEAR'};
 const report=spatialEvaluation([{...base,groundTruth:'SAME',spatialResult:'SAME_POSITION_SUSPECTED'},{...base,groundTruth:'SAME',spatialResult:'UNCERTAIN',tracking:'LOST'},{...base,groundTruth:'DIFFERENT',spatialResult:'SAME_POSITION_SUSPECTED'}]);
 expect(report.overall.sameFixtureDetectionRate).toBe(.5);expect(report.overall.falseSameFixtureRate).toBe(1);expect(report.overall.trackingFailureRate).toBe(1/3);expect(report.byDeviceOS['device / os']?.spatialUncertaintyRate).toBe(1/3);
});
