import { describe, expect, it } from 'vitest';
import { staffRecordSchema } from './staffRecord.validation.js';

const staff = { name: 'Test worker', phone: '0300 1234567' };

describe('staff record validation', () => {
  it.each([undefined, '', '   '])('treats %j email as absent and ignores a password key', email => {
    const parsed = staffRecordSchema.parse({ ...staff, email, password: 'ignored' });
    expect(parsed.email).toBeUndefined();
    expect(parsed.phone).toBe('+923001234567');
    expect(parsed).not.toHaveProperty('password');
  });

  it('validates email and name limits', () => {
    const longestEmail = `a@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.${'e'.repeat(56)}.com`;
    expect(staffRecordSchema.parse({ ...staff, email: ' worker@example.com ' }).email).toBe('worker@example.com');
    expect(staffRecordSchema.safeParse({ ...staff, email: 'invalid' }).success).toBe(false);
    expect(longestEmail).toHaveLength(254);
    expect(staffRecordSchema.safeParse({ ...staff, email: longestEmail }).success).toBe(true);
    expect(staffRecordSchema.safeParse({ ...staff, email: `a${longestEmail}` }).success).toBe(false);
    expect(staffRecordSchema.safeParse({ ...staff, name: 'x'.repeat(151) }).success).toBe(false);
  });

  it.each([
    { shiftStart: '1970-01-01T08:00:00Z' },
    { shiftEnd: '1970-01-01T16:00:00Z' },
    { shiftStart: '1970-01-01T08:00:00Z', shiftEnd: '1970-01-02T08:00:30Z' },
  ])('rejects unpaired or equal shift times %j', shift => {
    expect(staffRecordSchema.safeParse({ ...staff, ...shift }).success).toBe(false);
  });

  it.each([undefined, '', '021 12345678', 3001234567])('tags the phone issue for %j', phone => {
    expect(staffRecordSchema.safeParse({ ...staff, phone })).toMatchObject({
      success: false,
      error: { issues: [{ path: ['phone'], params: { code: 'INVALID_PHONE' } }] },
    });
  });

  it('normalizes work days and keeps the field optional', () => {
    expect(staffRecordSchema.parse(staff)).not.toHaveProperty('workDays');
    expect(staffRecordSchema.parse({ ...staff, workDays: ['WED', 'MON', 'WED'] }).workDays).toEqual(['MON', 'WED']);
  });

  it.each([[[]], [['MON', 'FRIDAY']], [null], ['MON']])('tags the work days issue for %j', (workDays) => {
    expect(staffRecordSchema.safeParse({ ...staff, workDays })).toMatchObject({
      success: false,
      error: { issues: [{
        path: ['workDays'],
        message: 'Choose at least one work day.',
        params: { code: 'INVALID_WORK_DAYS' },
      }] },
    });
  });
});
