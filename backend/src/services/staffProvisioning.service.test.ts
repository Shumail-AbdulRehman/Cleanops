import { expect, it, vi } from 'vitest';
import { insertStaff } from './staffProvisioning.service.js';

function mockTransaction() {
  const lock = vi.fn();
  const findUnique = vi.fn().mockResolvedValue(null);
  const findFirst = vi.fn().mockResolvedValue(null);
  const create = vi.fn().mockResolvedValue({ id: 7 });
  const tx = { $queryRaw: lock, staff: { findUnique, findFirst, create } } as unknown as Parameters<typeof insertStaff>[0];
  return { tx, lock, findUnique, findFirst, create };
}

const input = { name: 'Worker', phone: '0300 123-4567', email: 'A@example.com', password: 'legacy-password' };

it('locks normalized identities before looking them up and inserts a fresh password on each call', async () => {
  const { tx, lock, findUnique, findFirst, create } = mockTransaction();
  expect(await insertStaff(tx, 1, input)).toEqual({ id: 7 });
  expect(lock).toHaveBeenCalledBefore(findUnique);
  expect(lock).toHaveBeenCalledBefore(findFirst);
  expect(lock.mock.calls[0]![1].values).toEqual(['+923001234567', input.email]);
  expect(findUnique).toHaveBeenCalledWith({ where: { phone: '+923001234567' }, select: { id: true } });
  expect(create).toHaveBeenCalledWith({ data: {
    name: input.name, email: input.email, phone: '+923001234567', password: expect.stringMatching(/^[a-f0-9]{64}$/),
    companyId: 1, locationId: null, shiftStart: null, shiftEnd: null, mustChangePassword: false,
  } });
  await insertStaff(tx, 1, input);
  expect(create.mock.calls[0]![0].data.password).not.toBe(input.password);
  expect(create.mock.calls[0]![0].data.password).not.toBe(create.mock.calls[1]![0].data.password);
});

it('rejects a globally used phone with PHONE_IN_USE', async () => {
  const { tx, findUnique, create } = mockTransaction();
  findUnique.mockResolvedValue({ id: 8 });
  await expect(insertStaff(tx, 1, input)).rejects.toMatchObject({
    statusCode: 409, message: 'This phone number is already used by another staff member.', errors: [{ code: 'PHONE_IN_USE' }],
  });
  expect(create).not.toHaveBeenCalled();
});

it('checks existing email case-insensitively and reports EMAIL_IN_USE', async () => {
  const { tx, findFirst, create } = mockTransaction();
  findFirst.mockImplementation(async ({ where }) => where.email.mode === 'insensitive' &&
    where.email.equals.toLowerCase() === 'a@example.com' ? { id: 9 } : null);
  await expect(insertStaff(tx, 1, input)).rejects.toMatchObject({
    statusCode: 409, message: 'This email is already used by another staff member.', errors: [{ code: 'EMAIL_IN_USE' }],
  });
  expect(create).not.toHaveBeenCalled();
});

it('skips the email lock and lookup when email is absent', async () => {
  const { tx, lock, findFirst, create } = mockTransaction();
  await insertStaff(tx, 1, { ...input, email: undefined });
  expect(lock.mock.calls[0]![1].values).toEqual(['+923001234567']);
  expect(findFirst).not.toHaveBeenCalled();
  expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ email: null, mustChangePassword: false }) });
});

it('passes validated work days through to the staff insert', async () => {
  const { tx, create } = mockTransaction();
  await insertStaff(tx, 1, { ...input, workDays: ['MON', 'WED'] });
  expect(create.mock.calls[0]![0].data.workDays).toEqual(['MON', 'WED']);
});

it('rejects an invalid phone from the legacy caller before accessing Prisma', async () => {
  const { tx, lock, create } = mockTransaction();
  await expect(insertStaff(tx, 1, { ...input, phone: '02112345678' })).rejects.toMatchObject({
    statusCode: 400, errors: [{ code: 'INVALID_PHONE' }],
  });
  expect(lock).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});
