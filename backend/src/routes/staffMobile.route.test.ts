import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { AddressInfo } from 'node:net';

const m = vi.hoisted(() => ({
  role: 'STAFF' as 'STAFF' | 'MANAGER' | 'ADMIN',
  principal: vi.fn(),
  tasks: vi.fn(),
  attendance: vi.fn(),
  history: vi.fn(),
  month: vi.fn(),
  profile: vi.fn(),
}));
vi.mock('../prisma/prisma.js', () => ({ prisma: { manager: { findUnique: m.principal }, staff: { findUnique: m.principal }, managerLocation: { findMany: async () => [] } } }));
vi.mock('../services/mobile/staffMobile.service.js', () => ({ staffMobileTasks: m.tasks, staffMobileAttendance: m.attendance }));
vi.mock('../services/mobile/staffHistory.service.js', () => ({ staffTaskHistory: m.history }));
vi.mock('../services/mobile/staffAttendanceMonth.service.js', () => ({ staffAttendanceMonth: m.month }));
vi.mock('../services/mobile/staffProfileSummary.service.js', () => ({ staffProfileSummary: m.profile }));

import router from './staffMobile.route.js';
import { ApiError } from '../utils/ApiError.js';

let server: ReturnType<express.Express['listen']>, origin: string;
const token = () => jwt.sign({ id: 5, role: m.role, credentialVersion: 0, tokenUse: 'access' }, 'staff-route-test-secret', { expiresIn: '5m' });
const request = (path: string, anonymous = false) =>
  fetch(origin + '/api/staff/mobile' + path, { headers: anonymous ? {} : { authorization: 'Bearer ' + token() } });
const newServices = [
  ['/history', m.history],
  ['/attendance/month', m.month],
  ['/profile', m.profile],
] as const;
const actor = expect.objectContaining({ id: 5, companyId: 9, role: 'STAFF', locationId: 3 });

beforeAll(async () => {
  process.env.ACCESS_TOKEN_SECRET = 'staff-route-test-secret';
  const app = express();
  app.use('/api/staff/mobile', router);
  // Same shape as the app-level handler for ApiError: status and message pass through.
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ApiError) return void res.status(error.statusCode).json({ success: false, message: error.message });
    res.status(500).json({ success: false, message: 'Something went wrong' });
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});
afterAll(async () => new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve()))));
beforeEach(() => {
  vi.clearAllMocks();
  m.role = 'STAFF';
  m.principal.mockImplementation(async () => ({
    id: 5, name: 'Staff', email: 'staff@example.invalid', companyId: 9, locationId: 3, role: m.role, isActive: true,
    credentialVersion: 0, mustChangePassword: false, company: { isActive: true, operationalStatus: 'ACTIVE' },
  }));
  m.tasks.mockResolvedValue({ items: [], nextCursor: null });
  m.attendance.mockResolvedValue({ today: null });
  m.history.mockResolvedValue({ kind: 'history' });
  m.month.mockResolvedValue({ kind: 'month' });
  m.profile.mockResolvedValue({ kind: 'profile' });
});

it.each(newServices)('anonymous request to %s is 401 and never reaches the service', async (path, service) => {
  expect((await request(path, true)).status).toBe(401);
  expect(service).not.toHaveBeenCalled();
});

it.each(newServices)('manager token on %s is 403 and never reaches the service', async (path, service) => {
  m.role = 'MANAGER';
  expect((await request(path)).status).toBe(403);
  expect(service).not.toHaveBeenCalled();
});

it('history passes the staff actor and query, and returns the envelope with no-store', async () => {
  const response = await request('/history?month=2026-10&filter=missed&cursor=abc&limit=10');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toEqual({ success: true, data: { kind: 'history' } });
  expect(m.history).toHaveBeenCalledOnce();
  expect(m.history.mock.calls[0]![0]).toEqual(actor);
  expect({ ...m.history.mock.calls[0]![1] }).toEqual({ month: '2026-10', filter: 'missed', cursor: 'abc', limit: '10' });
});

it('attendance month passes the staff actor and query, and returns the envelope with no-store', async () => {
  const response = await request('/attendance/month?month=2026-10');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toEqual({ success: true, data: { kind: 'month' } });
  expect(m.month).toHaveBeenCalledOnce();
  expect(m.month.mock.calls[0]![0]).toEqual(actor);
  expect({ ...m.month.mock.calls[0]![1] }).toEqual({ month: '2026-10' });
  expect(m.attendance).not.toHaveBeenCalled();
});

it('profile passes only the staff actor, and returns the envelope with no-store', async () => {
  const response = await request('/profile');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toEqual({ success: true, data: { kind: 'profile' } });
  expect(m.profile).toHaveBeenCalledOnce();
  expect(m.profile.mock.calls[0]).toEqual([actor]);
});

it.each([['/history', m.history], ['/attendance/month', m.month]] as const)('an out-of-range month on %s reaches the service and its 400 passes through', async (path, service) => {
  service.mockRejectedValueOnce(new ApiError(400, 'Choose a month from your history'));
  const response = await request(path + '?month=2026-13');
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ success: false, message: 'Choose a month from your history' });
  expect({ ...service.mock.calls[0]![1] }).toEqual({ month: '2026-13' });
});

it('a validation error from a new service maps to 400 "Invalid mobile query"', async () => {
  m.history.mockRejectedValueOnce(z.object({ limit: z.number() }).safeParse({ limit: 'x' }).error);
  const response = await request('/history?limit=x');
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ success: false, message: 'Invalid mobile query' });
});

it('existing /tasks and /attendance routes still respond as before', async () => {
  const tasks = await request('/tasks?cursor=c1');
  expect(tasks.status).toBe(200);
  expect(await tasks.json()).toEqual({ success: true, data: { items: [], nextCursor: null } });
  expect(m.tasks.mock.calls[0]![0]).toEqual(actor);
  expect({ ...m.tasks.mock.calls[0]![1] }).toEqual({ cursor: 'c1' });
  expect(tasks.headers.get('cache-control')).not.toBe('private, no-store');

  const attendance = await request('/attendance');
  expect(attendance.status).toBe(200);
  expect(await attendance.json()).toEqual({ success: true, data: { today: null } });
  expect(m.attendance.mock.calls[0]).toEqual([actor]);
  expect(m.month).not.toHaveBeenCalled();

  m.role = 'MANAGER';
  expect((await request('/tasks')).status).toBe(403);
  expect((await request('/attendance', true)).status).toBe(401);
});
