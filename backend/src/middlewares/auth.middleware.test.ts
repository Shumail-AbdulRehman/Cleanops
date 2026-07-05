import {describe,it,expect,vi,beforeEach} from 'vitest';
import jwt from 'jsonwebtoken';
import type {Request,Response} from 'express';
const m=vi.hoisted(()=>({staff:vi.fn(),manager:vi.fn(),locations:vi.fn()}));
vi.mock('../prisma/prisma.js',()=>({prisma:{staff:{findUnique:m.staff},manager:{findUnique:m.manager},managerLocation:{findMany:m.locations}}}));
import {verifyJwt,verifyOwnSecurityJwt,verifyPasswordChangeJwt} from './auth.middleware.js';
process.env.ACCESS_TOKEN_SECRET='test-auth-secret';
const request=(role:string)=>({cookies:{},header:()=>`Bearer ${jwt.sign({id:1,role,tokenUse:'access'},'test-auth-secret',{expiresIn:'15m'})}`} as unknown as Request);
beforeEach(()=>{vi.resetAllMocks();m.locations.mockResolvedValue([]);});
describe('active JWT principals',()=>{
 it('rejects inactive staff',async()=>{m.staff.mockResolvedValue({id:1,companyId:1,role:'STAFF',isActive:false,company:{isActive:true}});await expect(verifyJwt(request('STAFF'),{} as Response,vi.fn())).rejects.toMatchObject({statusCode:403});});
 it('rejects obsolete role claims against the current manager role',async()=>{m.manager.mockResolvedValue({id:1,role:'MANAGER',isActive:true,company:{isActive:true}});await expect(verifyJwt(request('ADMIN'),{} as Response,vi.fn())).rejects.toMatchObject({statusCode:401});});
 it('rejects disabled companies',async()=>{m.staff.mockResolvedValue({id:1,role:'STAFF',isActive:true,company:{isActive:false}});await expect(verifyJwt(request('STAFF'),{} as Response,vi.fn())).rejects.toMatchObject({statusCode:403});});
 it('loads staff and manager IDs from separate tables',async()=>{m.staff.mockResolvedValue({id:1,companyId:1,role:'STAFF',isActive:true,company:{isActive:true}});const req=request('STAFF');await verifyJwt(req,{} as Response,vi.fn());expect(m.manager).not.toHaveBeenCalled();expect(req.user).toMatchObject({id:1,role:'STAFF'});expect(req.user).not.toHaveProperty('company');});
});
it('rejects a credential version changed by password reset before authorizing access',async()=>{
 m.staff.mockResolvedValue({id:1,companyId:1,role:'STAFF',credentialVersion:1,isActive:true,company:{isActive:true}});
 const next=vi.fn();await expect(verifyJwt(request('STAFF'),{} as Response,next)).rejects.toMatchObject({statusCode:401,errors:[{code:'SESSION_REVOKED'}]});expect(next).not.toHaveBeenCalled();
});
it('requires forced replacement before operational access',async()=>{
 m.staff.mockResolvedValue({id:1,companyId:1,role:'STAFF',credentialVersion:0,mustChangePassword:true,isActive:true,company:{isActive:true}});
 await expect(verifyJwt(request('STAFF'),{} as Response,vi.fn())).rejects.toMatchObject({statusCode:403,errors:[{code:'PASSWORD_CHANGE_REQUIRED'}]});
});

it.each(['ADMIN','MANAGER','STAFF'])('active %s retains only own security during company suspension',async role=>{
 const principal={id:1,companyId:1,role,isActive:true,company:{isActive:false,operationalStatus:'SUSPENDED'},credentialVersion:0,mustChangePassword:false};
 (role==='STAFF'?m.staff:m.manager).mockResolvedValue(principal);
 await expect(verifyOwnSecurityJwt(request(role),{} as Response,vi.fn())).resolves.toBeUndefined();
 await expect(verifyJwt(request(role),{} as Response,vi.fn())).rejects.toMatchObject({statusCode:403,errors:[{code:'ACCOUNT_SUSPENDED'}]});
 principal.mustChangePassword=true;
 await expect(verifyOwnSecurityJwt(request(role),{} as Response,vi.fn())).rejects.toMatchObject({statusCode:403});
 await expect(verifyPasswordChangeJwt(request(role),{} as Response,vi.fn())).resolves.toBeUndefined();
 principal.credentialVersion=1;
 await expect(verifyPasswordChangeJwt(request(role),{} as Response,vi.fn())).rejects.toMatchObject({statusCode:401});
});
it('an operator context cannot use any tenant auth adapter',async()=>{
 const req=request('ADMIN');req.operator={issuer:'https://issuer.example.invalid',subject:'provisioned'} as any;
 await expect(verifyOwnSecurityJwt(req,{} as Response,vi.fn())).rejects.toMatchObject({statusCode:401});expect(m.manager).not.toHaveBeenCalled();
});
