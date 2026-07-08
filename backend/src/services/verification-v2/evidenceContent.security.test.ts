import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({asset:vi.fn(),task:vi.fn(),location:vi.fn(),audit:vi.fn(),read:vi.fn()}));
vi.mock('../../prisma/prisma.js',()=>({prisma:{evidenceAsset:{findUnique:m.asset}}}));
vi.mock('./authorization.service.js',()=>({requireTaskAccess:m.task,requireLocationAccess:m.location,requireOperationalRole:vi.fn()}));
vi.mock('./media.service.js',()=>({storePrivateImage:vi.fn(),privateImageBytes:vi.fn()}));
vi.mock('./exception.service.js',()=>({raiseIssue:vi.fn()}));
vi.mock('./jobQueue.service.js',()=>({enqueueVerificationJob:vi.fn()}));
vi.mock('../auditLog.service.js',()=>({writeAuditLog:m.audit}));
import {evidenceContent} from './evidence.service.js';
const actor={id:1,companyId:1,role:'MANAGER'} as const;
const asset={id:'photo',companyId:1,taskInstanceId:7,privacyState:'HOLD',deliveryType:'authenticated',originalPublicId:'original',sanitizedPublicId:'review',format:'png'};
beforeEach(()=>{vi.resetAllMocks();m.asset.mockResolvedValue(asset);m.read.mockResolvedValue(Buffer.from('image'));});
it.each(['MANAGER','ADMIN'] as const)('allows scoped %s review of held evidence, without changing its review state',async role=>{const result=await evidenceContent({...actor,role},'photo','review',{store:vi.fn(),read:m.read});expect(result.format).toBe('jpeg');expect(m.task).toHaveBeenCalledWith({...actor,role},7);expect(m.read).toHaveBeenCalledWith('review','jpg');expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({actorType:role,action:'RESTRICTED_EVIDENCE_VIEWED',newValue:{assetId:'photo',variant:'review',privacyState:'HOLD'}}));});
it('staff cannot view held evidence',async()=>{await expect(evidenceContent({...actor,role:'STAFF'},'photo','review',{store:vi.fn(),read:m.read})).rejects.toMatchObject({statusCode:403});expect(m.read).not.toHaveBeenCalled();});
it('does not expose foreign-company or unauthorized-location photos',async()=>{m.asset.mockResolvedValue({...asset,companyId:2});await expect(evidenceContent(actor,'photo','review',{store:vi.fn(),read:m.read})).rejects.toMatchObject({statusCode:404});m.asset.mockResolvedValue(asset);m.task.mockRejectedValue(new Error('Access denied'));await expect(evidenceContent(actor,'photo','review',{store:vi.fn(),read:m.read})).rejects.toThrow('Access denied');expect(m.read).not.toHaveBeenCalled();});
it('held originals and unfinished privacy checks stay restricted',async()=>{await expect(evidenceContent({...actor,role:'ADMIN'},'photo','original',{store:vi.fn(),read:m.read})).rejects.toMatchObject({statusCode:403});m.asset.mockResolvedValue({...asset,privacyState:'PENDING'});await expect(evidenceContent(actor,'photo','review',{store:vi.fn(),read:m.read})).rejects.toMatchObject({statusCode:403});expect(m.read).not.toHaveBeenCalled();});

it.each(['upload','private'])('does not let restricted manager review bypass authenticated delivery (%s)',async deliveryType=>{
 m.asset.mockResolvedValue({...asset,deliveryType});
 await expect(evidenceContent(actor,'photo','review',{store:vi.fn(),read:m.read})).rejects.toMatchObject({statusCode:403});
 expect(m.read).not.toHaveBeenCalled();expect(m.audit).not.toHaveBeenCalled();
});
