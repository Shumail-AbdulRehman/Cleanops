import { z } from 'zod';
import { INVALID_PAKISTAN_PHONE_MESSAGE, normalizePakistanPhone } from '../utils/pakistanPhone.js';
import { workDaysSchema } from '../utils/workDays.js';

const phone = z.unknown().transform((value, ctx) => {
  const normalized = normalizePakistanPhone(value);
  if (normalized) return normalized;
  ctx.addIssue({ code: 'custom', message: INVALID_PAKISTAN_PHONE_MESSAGE, params: { code: 'INVALID_PHONE' } });
  return z.NEVER;
});

const email = z.string().trim().transform(value => value || undefined)
  .pipe(z.email({ message: 'Enter a valid email.' }).max(254, 'Enter a valid email.').optional()).optional();

export const staffRecordSchema = z.object({
  name: z.string().min(2, 'Enter a name between 2 and 150 characters.').max(150, 'Enter a name between 2 and 150 characters.'),
  phone,
  email,
  locationId: z.number().int().positive().optional(),
  shiftStart: z.coerce.date({ message: 'Shift start must be a valid date' }).optional(),
  shiftEnd: z.coerce.date({ message: 'Shift end must be a valid date' }).optional(),
  workDays: workDaysSchema.optional(),
}).superRefine(({ shiftStart, shiftEnd }, ctx) => {
  if (!shiftStart || !shiftEnd) {
    if (shiftStart || shiftEnd) {
      ctx.addIssue({ code: 'custom', message: 'Both shiftStart and shiftEnd must be provided together', path: [shiftStart ? 'shiftEnd' : 'shiftStart'] });
    }
    return;
  }
  if (shiftStart.getUTCHours() === shiftEnd.getUTCHours() && shiftStart.getUTCMinutes() === shiftEnd.getUTCMinutes()) {
    ctx.addIssue({ code: 'custom', message: 'Shift start and end cannot be the same time', path: ['shiftEnd'] });
  }
});

export type StaffRecordInput = z.output<typeof staffRecordSchema>;
