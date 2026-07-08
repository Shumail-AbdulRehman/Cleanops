import { describe, it, expect, vi } from 'vitest';
import { reviewReplacementContext } from './launchReviewContext.js';
import { launchQualificationStatus } from './launchQualification.js';
vi.mock('./launchQualification.js', () => ({ launchQualificationStatus: vi.fn(() => ({processingAllowed:false,automaticApproval:false})) }));
const now = new Date('2026-10-21T04:00:00Z');
const session = {id:'session',taskInstanceId:1,staffId:2,assignmentEpoch:3,assignmentId:4,captureExpiresAt:new Date(+now+60000),uploadExpiresAt:new Date(+now+120000),state:'ACTIVE'};
const task = {id:1,staffId:2,assignmentEpoch:3,status:'IN_PROGRESS',isActive:true,staffSubmittedAt:null};
const requirement = {id:'view',state:'RECAPTURE_REQUIRED',mandatory:true,decisionVersion:2,currentAttemptId:'attempt',item:{mandatory:true}};
const attempt = {id:'attempt',requirementId:'view',state:'RECAPTURE_REQUIRED',receivedAt:now,staffId:2,assignmentEpoch:3,session,slot:{generation:1}};
const input = {task,session,requirement,attempt,staffId:2,now,expectedGeneration:2};
describe('read-only review replacement context', () => {
 it('distinguishes policy eligibility from unavailable qualified processing without exposing authority', () => {
  expect(reviewReplacementContext(input,'SINK',4)).toEqual({policyEligible:true,available:false,reason:'PHOTO_QUALIFICATION_UNAVAILABLE',policyReason:'STAFF_CAPTURE_FLOW_REQUIRED',processingAllowed:false,automaticApproval:false});
 });
 it.each([
  {...input,task:{...task,staffSubmittedAt:now}},
  {...input,task:{...task,status:'COMPLETED'}},
  {...input,task:{...task,isActive:false}},
  {...input,task:{...task,assignmentEpoch:4}},
  {...input,session:{...session,captureExpiresAt:now}},
  {...input,attempt:{...attempt,state:'SERVICE_FAILURE'}},
  {...input,attempt:{...attempt,receivedAt:null}},
  {...input,requirement:{...requirement,state:'PASSED'}},
 ])('preserves failed-view/current authority denial %j', value => {
  expect(reviewReplacementContext(value,'SINK',4).policyEligible).toBe(false);
 });
 it('requires the current assignment and a known session', () => {
  expect(reviewReplacementContext(input,'SINK',9).policyEligible).toBe(false);
  expect(reviewReplacementContext(null,'SINK',4).policyEligible).toBe(false);
 });
 it('identifies cleaning as fresh task QR flow without granting manager retake', () => {
  const result = reviewReplacementContext({...input,cleaning:true,requirement:{...requirement,state:'CLEANING_REQUIRED'},attempt:{...attempt,state:'CLEANING_REQUIRED'}},'SINK',4);
  expect(result.policyEligible).toBe(true);expect(result.policyReason).toBe('FRESH_TASK_QR_REQUIRED');expect(result.available).toBe(false);
 });
 it('never infers automatic approval from replacement eligibility', () => {
  vi.mocked(launchQualificationStatus).mockReturnValueOnce({processingAllowed:true,automaticApproval:false,reason:'qualified',releaseReason:'approved',pipelineSha256:null});
  const result=reviewReplacementContext(input,'SINK',4);expect(result.available).toBe(true);expect(result.automaticApproval).toBe(false);
 });
});
