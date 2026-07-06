import { expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
const auth=vi.hoisted(()=>({verify:vi.fn((_req:unknown,_res:unknown,next:()=>void)=>next())}));

vi.mock('../prisma/prisma.js', () => ({ prisma: { $queryRaw: vi.fn().mockResolvedValue([]) } }));
vi.mock('../middlewares/auth.middleware.js', () => ({ verifyJwt: auth.verify }));
vi.mock('../services/verification-v2/authorization.service.js', () => ({
  requireActiveActor: vi.fn(), requireTaskAccess: vi.fn(), requireOperationalRole: vi.fn(),
}));
import {ApiError} from '../utils/ApiError.js';
import router from './verification.route.js';
import exceptionRouter from './verificationException.route.js';

it('reports missing migrations while allowing unrelated API routes to continue', async () => {
  const app = express();
  app.use('/api', router);
  app.use('/api', exceptionRouter);
  app.get('/api/unrelated', (_req, res) => res.json({ available: true }));
  app.post('/api/task-instance/1/start', (_req, res) => res.json({ available: true }));
  app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ code: error.errors?.[0]?.code }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  try {
    expect((await fetch(`${base}/unrelated`)).status).toBe(200);
    expect((await fetch(`${base}/task-instance/1/start`, { method: 'POST' })).status).toBe(200);
    expect(auth.verify).not.toHaveBeenCalled();
    const manifest = await fetch(`${base}/task-instance/1/verification`);
    expect(manifest.status).toBe(503);
    expect(await manifest.json()).toEqual({ code: 'VERIFICATION_SCHEMA_NOT_READY' });
    expect(auth.verify).toHaveBeenCalledTimes(1);
    const capabilities = await fetch(`${base}/verification-capabilities`);
    expect(capabilities.status).toBe(200);
    expect((await capabilities.json()).data.database.ready).toBe(false);
    expect(auth.verify).toHaveBeenCalledTimes(2);
    for (const path of ['/capture-session/test/resume', '/verification-attempt/test', '/task-instance/1/verification/history', '/task-instance/1/capture-sessions']) {
      const guarded = await fetch(`${base}${path}`, {method: path.endsWith('resume') || path.endsWith('capture-sessions') ? 'POST' : 'GET'});
      expect(guarded.status).toBe(503);
    }
    expect(auth.verify).toHaveBeenCalledTimes(6);

  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

it('does not label an unauthenticated request as verification service failure',async()=>{
 auth.verify.mockImplementationOnce((_req,_res,next)=>{(next as (error:unknown)=>void)(new ApiError(401,'Unauthorized access'));});
 const app=express();app.use('/api',router);
 app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.statusCode??500).json({code:error.errors?.[0]?.code}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 try{const response=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/verification-capabilities`);expect(response.status).toBe(401);expect(await response.json()).toEqual({code:'AUTH_REQUIRED'});}
 finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
