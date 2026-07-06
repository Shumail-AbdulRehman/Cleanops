import localOperatorSessionRouter from './localOperatorSession.route.js';
import { Router } from 'express';
import type { Application } from 'express';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { z } from 'zod';
import { ApiError } from '../utils/ApiError.js';
import ownerIdentityRouter from './ownerIdentity.route.js';
import platformCompanyRouter from './platformCompany.route.js';
import platformInsightsRouter from './platformInsights.route.js';
import platformSupportRouter, { customerSupportRouter } from './platformSupport.route.js';
import companySettingsRouter from './companySettings.route.js';
import attendanceAnnotationRouter from './attendanceAnnotation.route.js';
import subscriptionRouter from './subscription.route.js';
import commonRouter from './common.route.js';
import { operationalErrorFields, operationalLog } from '../utils/operationalLog.js';

/** Keep proxy configuration explicit: malformed values never enable trust. */
export function configureTrustProxy(app: Application, value = process.env.TRUST_PROXY_HOPS): void {
 const hops = value !== undefined && /^(0|[1-9]\d*)$/.test(value) ? Number(value) : NaN;
 const valid = Number.isSafeInteger(hops) && hops >= 0;
 app.set('trust proxy', valid ? hops : 0);
 if (value !== undefined && !valid) {
  operationalLog({event:'INVALID_TRUST_PROXY_HOPS'}, {level:'warn'});
 }
}

/** Express 5 delivers bind errors to this callback as well as successful binds. */
export function createListenCallback(onListening: () => void | Promise<void>, exit: (code: number) => unknown = code => process.exit(code)) {
 return async (error?: Error): Promise<void> => {
  if (error) {
   operationalLog({event:'SERVER_LISTEN_FAILED', ...operationalErrorFields(error)});
   exit(1);
   return;
  }
  await onListening();
 };
}

// Mount before operational routers. These adapters each own their audience;
// there is deliberately no tenant-auth wrapper around public/operator routes.
const router = Router();
router.use('/owner-identity', ownerIdentityRouter);
router.use('/platform/session', localOperatorSessionRouter);
router.use('/platform/companies', platformCompanyRouter);
router.use('/platform/service', platformSupportRouter);
router.use('/platform', platformInsightsRouter);
router.use('/support', customerSupportRouter);
router.use('/company/settings', companySettingsRouter);
router.use('/attendance', attendanceAnnotationRouter);
router.use('/subscription', subscriptionRouter);
router.use('/common', commonRouter);
export default router;

/** Known transport/schema conflicts, never raw SQL/provider errors or stacks. */
export const launchErrorHandler: import('express').ErrorRequestHandler = (error, req, res, _next) => {
 if(error instanceof z.ZodError) error = new ApiError(400,'Check the request details',[{code:'INVALID_REQUEST'},...error.issues.map(issue=>({field:issue.path.join('.'),message:issue.message}))]);
 if(error instanceof multer.MulterError) error = new ApiError(error.code==='LIMIT_FILE_SIZE'?413:400,'Upload limit exceeded',[{code:error.code}]);
 const code = (error as {code?:unknown})?.code;
 if(code==='P2002'||code==='P2034') error = new ApiError(409,'This record changed or already exists. Refresh and try again.',[{code:'CONFLICT'}]);
 if((error as {type?:unknown})?.type==='entity.too.large') error = new ApiError(413,'Request is too large',[{code:'REQUEST_TOO_LARGE'}]);
 if(error instanceof SyntaxError && 'body' in error) error = new ApiError(400,'Invalid JSON request',[{code:'INVALID_REQUEST'}]);
 if(error instanceof ApiError) {
  res.status(error.statusCode).json({success:false,message:error.message,errors:error.errors,code:error.errors[0]?.code??({400:'INVALID_REQUEST',401:'AUTH_REQUIRED',403:'FORBIDDEN',404:'NOT_FOUND',409:'CONFLICT',410:'AUTHORITY_EXPIRED',413:'REQUEST_TOO_LARGE',422:'INVALID_EVIDENCE',429:'CAPACITY_LIMIT',503:'SERVICE_UNAVAILABLE'} as Record<number,string>)[error.statusCode],details:error.errors});
  return;
 }
 const requestId = randomUUID();
 res.setHeader('X-Request-Id', requestId);
 operationalLog({event:'UNEXPECTED_REQUEST_ERROR', route:req.route?.path, method:req.method, status:500,
  companyId:req.user?.companyId, ...operationalErrorFields(error)}, {requestId});
 res.status(500).json({success:false,message:'Something went wrong',code:'INTERNAL_ERROR'});
};
