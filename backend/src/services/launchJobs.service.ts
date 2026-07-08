import { prisma } from '../prisma/prisma.js';
import type { VerificationTransaction } from './verification-v2/transaction.js';
import { readAccountState, evaluateAccountAccess } from './accountAccess.service.js';
import { ApiError } from '../utils/ApiError.js';

/** Scheduling/assignment creates new work; bookkeeping only needs active operations.
 * Account denial skips that tenant. Database/configuration failure propagates so
 * a job never quietly assumes entitlement or rewrites work as failed.
 */
export async function jobAccountAllowed(companyId: number, action: 'MANAGE_WORK' | 'READ_OPERATIONAL', tx: VerificationTransaction = prisma, now = new Date()) {
 try { evaluateAccountAccess(await readAccountState(companyId,tx),'SYSTEM',action,now);return true; }
 catch(error) { if(error instanceof ApiError && error.statusCode===403)return false;throw error; }
}
