import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../utils/ApiError.js';
const m=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('./accountAccess.service.js',async original=>({...await original<typeof import('./accountAccess.service.js')>(),readAccountState:m.read}));
import {jobAccountAllowed} from './launchJobs.service.js';
beforeEach(()=>{vi.resetAllMocks();m.read.mockResolvedValue({company:{id:1,isActive:true,operationalStatus:'ACTIVE',billingCustomerId:null,billingSubscriptionId:null},subscription:null});});
it('an unentitled active company allows bookkeeping but never schedules new work',async()=>{
 expect(await jobAccountAllowed(1,'READ_OPERATIONAL')).toBe(true);expect(await jobAccountAllowed(1,'MANAGE_WORK')).toBe(false);
});
it.each(['READ_OPERATIONAL','MANAGE_WORK'] as const)('suspension denies %s without granting an owner/system bypass',async action=>{
 m.read.mockResolvedValue({company:{isActive:true,operationalStatus:'SUSPENDED'},subscription:null});
 expect(await jobAccountAllowed(1,action)).toBe(false);
});
it('does not swallow driver/configuration failures as entitlement',async()=>{
 m.read.mockRejectedValue(new Error('database unavailable'));await expect(jobAccountAllowed(1,'MANAGE_WORK')).rejects.toThrow('database unavailable');
 m.read.mockRejectedValue(new ApiError(404,'Missing company'));await expect(jobAccountAllowed(1,'READ_OPERATIONAL')).rejects.toMatchObject({statusCode:404});
});
