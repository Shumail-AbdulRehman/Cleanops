import {assertAccountAction,assertAccountCompletion} from '../accountAccess.service.js';
vi.mock('../accountAccess.service.js',()=>({assertAccountAction:vi.fn(async()=>({})),assertAccountCompletion:vi.fn(async()=>({})),recordWorkEntitlement:vi.fn(async()=>{})}));
import {describe,it,expect,vi,beforeEach} from 'vitest';
const m=vi.hoisted(()=>({staff:vi.fn(),manager:vi.fn(),location:vi.fn(),area:vi.fn(),task:vi.fn(),assignment:vi.fn()}));
vi.mock('../../prisma/prisma.js',()=>({prisma:{staff:{findFirst:m.staff},manager:{findFirst:m.manager},location:{findFirst:m.location},area:{findUnique:m.area},taskInstance:{findUnique:m.task},managerLocation:{findUnique:m.assignment}}}));
import {requireTaskAccess,requireAreaAccess,requireLocationAccess,requireAssignmentAccess} from './authorization.service.js';
const staff={id:7,companyId:1,role:'STAFF' as const};
const manager={id:7,companyId:1,role:'MANAGER' as const};
beforeEach(()=>{vi.resetAllMocks();m.staff.mockResolvedValue({id:7,isActive:true,locationId:2});m.manager.mockResolvedValue({id:7,isActive:true});m.location.mockResolvedValue({id:2,companyId:1,isActive:true});m.assignment.mockResolvedValue({managerId:7,locationId:2});m.task.mockResolvedValue({id:3,isActive:true,locationId:2,location:{companyId:1,isActive:true},staffId:7,assignmentEpoch:4,assignments:[{id:8,staffId:7,status:'STARTED'}]});});
describe('verification authorization',()=>{
 it('does not authorize a manager with the same numeric staff ID',async()=>{await expect(requireTaskAccess(manager,3,{staffMutation:true})).rejects.toThrow('Staff account required');});
 it('rejects inactive staff before reading task evidence',async()=>{m.staff.mockResolvedValue(null);await expect(requireTaskAccess(staff,3)).rejects.toThrow('Active account');expect(m.task).not.toHaveBeenCalled();});
 it('hides foreign tenant tasks and areas',async()=>{m.task.mockResolvedValue({location:{companyId:2}});m.area.mockResolvedValue({location:{companyId:2}});await expect(requireTaskAccess(staff,3)).rejects.toThrow('Task not found');await expect(requireAreaAccess(manager,5)).rejects.toThrow('Area not found');});
 it('reads current staff and task scope once without duplicate actor/location queries',async()=>{await requireTaskAccess(staff,3,{staffMutation:true});expect(m.staff).toHaveBeenCalledOnce();expect(m.task).toHaveBeenCalledOnce();expect(m.location).not.toHaveBeenCalled();});
 it('rejects staff moved away even when token location claims are stale',async()=>{m.staff.mockResolvedValue({id:7,locationId:99});await expect(requireTaskAccess({...staff,locationId:2},3,{staffMutation:true})).rejects.toThrow('Location access');});
 it('rejects mutation at an inactive location',async()=>{m.task.mockResolvedValue({id:3,isActive:true,locationId:2,location:{companyId:1,isActive:false},staffId:7,assignments:[{id:8,staffId:7,status:'ASSIGNED'}]});await expect(requireTaskAccess(staff,3,{staffMutation:true})).rejects.toThrow('Location is inactive');});
 it('does not authorize task access with stale manager membership',async()=>{m.assignment.mockResolvedValue(null);await expect(requireTaskAccess(manager,3)).rejects.toThrow('Location access');expect(m.manager).toHaveBeenCalledOnce();});
 it('uses current manager location membership instead of stale actor claims',async()=>{m.assignment.mockResolvedValue(null);await expect(requireLocationAccess({...manager,locationIds:[2]},2)).rejects.toThrow('Location access');});
 it('rejects former owners and stale epochs',async()=>{await expect(requireAssignmentAccess(staff,3,8,3)).rejects.toThrow('Assignment changed');m.task.mockResolvedValue({id:3,isActive:true,locationId:2,location:{companyId:1,isActive:true},staffId:9,assignments:[]});await expect(requireTaskAccess(staff,3)).rejects.toThrow('Current active assignment');});
});

it('task mutations select start vs exact persisted completion policy; reads do not claim entitlement',async()=>{
 m.task.mockResolvedValue({id:3,isActive:true,status:'PENDING',locationId:2,location:{companyId:1,isActive:true},staffId:7,assignments:[{id:8,staffId:7,status:'ASSIGNED'}]});
 await requireTaskAccess(staff,3,{staffMutation:true});expect(assertAccountAction).toHaveBeenCalledWith(staff,'START_WORK',expect.anything());
 m.task.mockResolvedValue({id:3,isActive:true,status:'IN_PROGRESS',locationId:2,location:{companyId:1,isActive:true},staffId:7,assignments:[{id:8,staffId:7,status:'STARTED'}]});
 await requireTaskAccess(staff,3,{staffMutation:true});expect(assertAccountCompletion).toHaveBeenCalledWith(staff,{kind:'task',id:3},expect.anything());
 vi.mocked(assertAccountCompletion).mockRejectedValueOnce(new Error('Unproven entitlement'));
 await expect(requireTaskAccess(staff,3,{staffMutation:true})).rejects.toThrow('Unproven entitlement');
 await expect(requireTaskAccess(staff,3)).resolves.toHaveProperty('id',3);
});
