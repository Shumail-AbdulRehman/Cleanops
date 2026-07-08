import { z } from 'zod';
import {spatialUploadSchema} from './spatial.contracts.js';

export const WORKFLOW_VERSION = 2 as const;
export const reasonCodeSchema = z.enum([
  'PHOTO_OF_SCREEN', 'PHOTO_ORIGIN_UNCERTAIN', 'CLEF_CALIBRATION_REQUIRED', 'CANNOT_ASSESS', 'WRONG_ITEM', 'MISSING_SURFACE', 'PHOTO_TOO_DARK', 'PHOTO_BLURRY',
  'PHOTO_TOO_SMALL', 'DUPLICATE_EVIDENCE', 'IDENTITY_UNCERTAIN', 'OBJECT_UNCERTAIN', 'VIEW_UNCERTAIN', 'SERVICE_FAILURE',
  'PRIVACY_HOLD', 'OCCUPIED', 'DAMAGED', 'INACCESSIBLE', 'GPS_STALE', 'GPS_INACCURATE',
  'GPS_OUTSIDE', 'GPS_UNCERTAIN', 'CONTEXT_UNCERTAIN', 'MISSING_EVIDENCE', 'CLEANING_REQUIRED',
  'STALE_ASSIGNMENT', 'CLOCK_UNCERTAIN', 'SETUP_REQUIRED', 'CLEAN', 'AUTO_PASS_NOT_VALIDATED',
  'FIXTURE_POSITION_TOO_CLOSE_TO_PREVIOUS', 'TRACKING_LOST', 'LOW_TRACKING_QUALITY', 'INSUFFICIENT_MOVEMENT', 'WORLD_POINT_UNAVAILABLE', 'SPATIAL_CONTINUITY_BROKEN', 'POSITION_DISTINCT', 'SPATIAL_UNAVAILABLE', 'FIXTURE_POINT_UNCERTAIN', 'SPATIAL_BASELINE_ONLY',
]);
export type ReasonCode = z.infer<typeof reasonCodeSchema>;
export const presenceSchema = z.enum(['ACCEPTABLE', 'UNCERTAIN', 'OUTSIDE']);
export const requirementStateSchema = z.enum(['MISSING','PROCESSING','PASSED','RECAPTURE_REQUIRED','CLEANING_REQUIRED','REVIEW_REQUIRED','MANAGER_ACCEPTED','WAIVED']);
export const sessionStateSchema = z.enum(['ACTIVE','PAUSED','CLOSED','EXPIRED','REVOKED']);
export const attemptStateSchema = z.enum(['RESERVED','STORING','RECEIVED','QUALITY_CHECK','COVERAGE_CHECK','CLEANLINESS_CHECK','PASSED','RECAPTURE_REQUIRED','CLEANING_REQUIRED','REVIEW_REQUIRED','RETRY_WAIT','SERVICE_FAILURE','PRIVACY_HOLD']);
export const requiredViewsSchema = z.array(z.object({key:z.string().min(1).max(80),instructions:z.string().min(1).max(1000),mandatory:z.boolean().default(true)})).min(1).max(10).refine(views=>new Set(views.map(v=>v.key)).size===views.length,'Views must be unique');
export const locationSampleSchema = z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),accuracy:z.number().nonnegative().max(10000),sampledAt:z.iso.datetime()}).strict();
export const sessionRequestSchema = z.object({workflowVersion:z.literal(2).default(2),requestId:z.uuid(),areaQr:z.string().max(2048),deviceId:z.string().min(1).max(200),clientBootId:z.string().min(1).max(200),location:locationSampleSchema,clientTime:z.iso.datetime()}).strict();
export const reworkSessionRequestSchema = sessionRequestSchema.extend({requirements:z.array(z.object({requirementId:z.uuid(),expectedGeneration:z.number().int().nonnegative()}).strict()).min(1).max(200)}).refine(input=>new Set(input.requirements.map(r=>r.requirementId)).size===input.requirements.length,'Rework requirements must be unique');
// Client diagnostics are observations only. They never grant capture authority or a pass.
// Native builds save Date.now() values. Accept that existing queue format and
// normalize only telemetry; claimedCapturedAt and session timing stay strict.
const diagnosticTimestampSchema=z.union([
 z.iso.datetime(),
 z.number().int().min(0).max(253402300799999).transform(value=>new Date(value).toISOString()),
]);
const diagnosticSchema=z.object({capturedAt:diagnosticTimestampSchema.optional(),durableSavedAt:diagnosticTimestampSchema.optional(),uploadStartedAt:diagnosticTimestampSchema.optional(),localCategory:z.object({outcome:z.enum(['MATCH','CLEAR_MISMATCH','UNCERTAIN']),expectedCategory:z.string().max(40).nullable(),predictedCategory:z.string().max(40).nullable(),score:z.number().finite().nullable(),margin:z.number().finite().nullable(),durationMs:z.number().nonnegative(),modelVersion:z.string().max(100),reason:z.string().max(100)}).strict().optional()}).strict();
export const clientDiagnosticsSchema=z.preprocess(value=>{if(typeof value!=='string')return value;try{return JSON.parse(value);}catch{return value;}},diagnosticSchema.optional());
export const captureMetadataSchema = z.object({clientDiagnostics:clientDiagnosticsSchema,spatialEvidence:spatialUploadSchema,clientCaptureId:z.uuid(),slotId:z.uuid(),nonce:z.string().min(32).max(256),sha256:z.string().regex(/^[a-f0-9]{64}$/),claimedCapturedAt:z.iso.datetime(),elapsedMs:z.coerce.number().int().nonnegative().max(24*60*60*1000),bootId:z.string().min(1).max(200)}).strict();
export const decisionRequestSchema = z.object({requestId:z.uuid(),expectedVersion:z.number().int().nonnegative(),issueId:z.number().int().positive().optional(),requirementId:z.uuid().optional(),action:z.enum(['ACCEPT_EVIDENCE','ACCEPT_CONTEXT','REJECT_EVIDENCE','REQUEST_RECAPTURE','REQUEST_CLEANING','MARK_MAINTENANCE','WAIVE_REQUIREMENT','EXTEND_WINDOW','RESOLVE_ISSUE']),reasonCode:reasonCodeSchema,note:z.string().trim().min(1).max(1000),evidenceAttemptId:z.uuid().optional()}).strict();
export const verificationManifestSchema = z.object({workflowVersion:z.literal(2),taskId:z.number().int().positive(),areaId:z.number().int().positive(),areaName:z.string(),inventoryVersion:z.number().int().positive(),assignmentEpoch:z.number().int().nonnegative(),locationTimezone:z.string(),items:z.array(z.object({id:z.number().int().positive(),name:z.string(),mandatory:z.boolean(),state:requirementStateSchema,requirements:z.array(z.object({id:z.uuid(),viewKey:z.string(),instructions:z.string(),mandatory:z.boolean(),state:requirementStateSchema,decisionVersion:z.number().int().nonnegative()}))}))});
