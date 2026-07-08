vi.mock('./launchJobs.service.js',()=>({jobAccountAllowed:vi.fn(async()=>true)}));
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  transaction: vi.fn(), feature: vi.fn(), audit: vi.fn(),
  assignment: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  task: { update: vi.fn() }, staff: { findMany: vi.fn() },
  attendance: { findFirst: vi.fn() }, queryRaw: vi.fn(),
}));
vi.mock('../prisma/prisma.js', () => ({ prisma: {
  $transaction: m.transaction, taskAssignment: m.assignment, taskInstance: m.task,
  staff: m.staff, attendance: m.attendance,
} }));
vi.mock('./subscription.service.js', () => ({ companyHasFeature: m.feature }));
vi.mock('./auditLog.service.js', () => ({ writeAuditLog: m.audit }));
import { reassignExpiredAssignments } from './taskAssignment.service.js';

const task = {
  id: 10, title: 'Washroom', staffId: 73, locationId: 31, isActive: true,
  date: new Date('2026-10-09T19:00:00Z'), status: 'PENDING',
  shiftStart: new Date('2026-10-10T08:15:00Z'), shiftEnd: new Date('2026-10-10T10:00:00Z'),
  location: { companyId: 1, timezone: 'Asia/Karachi' },
};
const assignment = { id: 20, staffId: 73, taskInstanceId: 10, taskInstance: task };
const tx = { $queryRaw: m.queryRaw, taskAssignment: m.assignment, taskInstance: m.task };

describe('missed-start reassignment preserves worker access', () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T08:50:00Z'));
    vi.stubEnv('MAX_TASK_REASSIGNMENTS', '3');
    m.assignment.findMany.mockResolvedValue([assignment]);
    m.assignment.count.mockResolvedValue(1);
    m.assignment.findFirst.mockResolvedValue(assignment);
    m.assignment.create.mockResolvedValue({ id: 21 });
    m.feature.mockResolvedValue(true); m.staff.findMany.mockResolvedValue([]);
    m.transaction.mockImplementation(work => work(tx));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it('keeps the original assignment when no staff can take the task', async () => {
    expect(await reassignExpiredAssignments(10)).toEqual({ scanned: 1, reassigned: 0, failedWithoutReplacement: 1 });
    expect(m.assignment.update).not.toHaveBeenCalled();
    expect(m.task.update).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it('keeps the current assignment when the transfer limit has been reached', async () => {
    m.assignment.count.mockResolvedValue(4);
    await reassignExpiredAssignments(10);
    expect(m.staff.findMany).not.toHaveBeenCalled();
    expect(m.assignment.update).not.toHaveBeenCalled();
    expect(m.task.update).not.toHaveBeenCalled();
  });

  it('transfers authority atomically when an eligible replacement is available', async () => {
    m.assignment.findMany.mockResolvedValueOnce([assignment]).mockResolvedValue([]);
    m.staff.findMany.mockResolvedValue([{ id: 74, name: 'Replacement', shiftStart: new Date('1970-01-01T08:00:00Z'), shiftEnd: new Date('1970-01-01T12:00:00Z') }]);
    m.attendance.findFirst.mockResolvedValue({ status: 'CHECKED_IN', checkInTime: new Date('2026-10-10T08:00:00Z'), checkOutTime: null });
    expect((await reassignExpiredAssignments(10)).reassigned).toBe(1);
    expect(m.assignment.update).toHaveBeenCalledWith({ where: { id: 20 }, data: expect.objectContaining({ status: 'REASSIGNED', isCurrent: false }) });
    expect(m.assignment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ staffId: 74, isCurrent: true }) });
    expect(m.task.update).toHaveBeenCalledWith({ where: { id: 10 }, data: { staffId: 74 } });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'TASK_REASSIGNED' }), tx);
  });

  it('does not revoke an assignment that started while a replacement was being found', async () => {
    m.assignment.findMany.mockResolvedValueOnce([assignment]).mockResolvedValue([]);
    m.staff.findMany.mockResolvedValue([{ id: 74, shiftStart: new Date('1970-01-01T08:00:00Z'), shiftEnd: new Date('1970-01-01T12:00:00Z') }]);
    m.attendance.findFirst.mockResolvedValue({ status: 'CHECKED_IN', checkInTime: new Date('2026-10-10T08:00:00Z'), checkOutTime: null });
    m.assignment.findFirst.mockResolvedValue(null);
    await reassignExpiredAssignments(10);
    expect(m.assignment.update).not.toHaveBeenCalled();
    expect(m.task.update).not.toHaveBeenCalled();
  });
});
