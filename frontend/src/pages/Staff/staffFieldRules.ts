import type { ChangeEvent } from 'react';
import type { RegisterOptions, UseFormRegisterReturn } from 'react-hook-form';
import type { Weekday } from '@/lib/workDays';

const messages = {
  nameRequired: 'Full name is required.',
  nameLength: 'Enter a name between 2 and 150 characters.',
  nameFormat: 'Use letters only in the name.',
  phoneRequired: 'Phone number is required.',
  phoneFormat: 'Enter a Pakistan mobile number, like 03001234567.',
  emailFormat: 'Enter a valid email, like name@example.com.',
  siteRequired: 'Choose a site.',
  shiftPair: 'Enter both shift start and shift end.',
  shiftDifferent: 'Shift start and end must be different.',
  workDaysRequired: 'Choose at least one work day.',
  workDaysConflict: 'This person has schedules on the days you removed: {titles}. Change those schedules first.',
  reasonRequired: 'Enter a reason.',
  reasonLength: 'Keep the reason under 1000 characters.',
  phoneInUse: 'This phone number is already used by another staff member.',
  emailInUse: 'This email is already used by another staff member.',
} as const;

const nameLength = {
  min: { value: 2, message: messages.nameLength },
  max: { value: 150, message: messages.nameLength },
};
const namePattern = /^(?=.*\p{L})(?:\p{L}\p{M}*|[ .'-])+$/u;
const emailMaxLength = { value: 254, message: messages.emailFormat };
const emailPattern = /^(?!\.)(?!.*\.\.)(?!.*\.@)[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
const reasonMaxLength = { value: 1000, message: messages.reasonLength };

function trim(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

export function checkStaffName(value: string): true | string {
  const name = trim(value);
  if (!name) return messages.nameRequired;
  if (name.length < nameLength.min.value || name.length > nameLength.max.value) return messages.nameLength;
  return namePattern.test(name) || messages.nameFormat;
}

export function checkStaffPhone(value: string): true | string {
  const phone = trim(value);
  if (!phone) return messages.phoneRequired;
  // Keep the accepted prefixes and separators in sync with backend pakistanPhone.ts.
  const compact = phone.replace(/[\s()[\]-]/g, '');
  return /^(?:0|92|\+92|0092)?3[0-9]{9}$/.test(compact) || messages.phoneFormat;
}

export function checkStaffEmail(value: string): true | string {
  const email = trim(value);
  return !email || (email.length <= emailMaxLength.value && emailPattern.test(email)) || messages.emailFormat;
}

export function checkStaffSite(value: string | undefined, required: boolean): true | string {
  return !required || Boolean(trim(value)) || messages.siteRequired;
}

type StaffShiftFields = { shiftStart?: string; shiftEnd?: string };

export function checkStaffShift(start: string | undefined, end: string | undefined) {
  const shiftStart = trim(start);
  const shiftEnd = trim(end);
  if (shiftStart && !shiftEnd) return { field: 'shiftEnd', message: messages.shiftPair } as const;
  if (shiftEnd && !shiftStart) return { field: 'shiftStart', message: messages.shiftPair } as const;
  if (shiftStart && shiftStart === shiftEnd) return { field: 'shiftEnd', message: messages.shiftDifferent } as const;
  return undefined;
}

export function checkStaffReason(value: string): true | string {
  const reason = trim(value);
  if (!reason) return messages.reasonRequired;
  return reason.length <= reasonMaxLength.value || messages.reasonLength;
}

export const staffNameRules = {
  required: messages.nameRequired,
  minLength: nameLength.min,
  maxLength: nameLength.max,
  pattern: { value: namePattern, message: messages.nameFormat },
  setValueAs: trim,
} satisfies RegisterOptions;

export const staffPhoneRules = {
  required: messages.phoneRequired,
  validate: checkStaffPhone,
  setValueAs: trim,
} satisfies RegisterOptions;

export const staffEmailRules = {
  maxLength: emailMaxLength,
  pattern: { value: emailPattern, message: messages.emailFormat },
  setValueAs: trim,
} satisfies RegisterOptions;

export function staffSiteRules(required: boolean) {
  return {
    required: required ? messages.siteRequired : false as const,
    validate: (value: string | undefined) => checkStaffSite(value, required),
  } satisfies RegisterOptions;
}

export const staffShiftStartRules = {
  deps: 'shiftEnd',
  setValueAs: trim,
  validate: (value: string | undefined, { shiftEnd }: StaffShiftFields) => {
    const issue = checkStaffShift(value, shiftEnd);
    return issue?.field === 'shiftStart' ? issue.message : true;
  },
} satisfies RegisterOptions<StaffShiftFields>;

export const staffShiftEndRules = {
  deps: 'shiftStart',
  setValueAs: trim,
  validate: (value: string | undefined, { shiftStart }: StaffShiftFields) => {
    const issue = checkStaffShift(shiftStart, value);
    return issue?.field === 'shiftEnd' ? issue.message : true;
  },
} satisfies RegisterOptions<StaffShiftFields>;

export function staffShiftInputEvents(registration: UseFormRegisterReturn<keyof StaffShiftFields>) {
  return {
    ...registration,
    // A time fill can set the DOM value before firing input, bypassing React's change detection.
    onInput: registration.onChange,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      if (event.nativeEvent.type === 'change') void registration.onChange(event);
    },
  };
}

export const staffReasonRules = {
  required: messages.reasonRequired,
  maxLength: reasonMaxLength,
  setValueAs: trim,
} satisfies RegisterOptions;

export const staffWorkDaysRules = {
  validate: (days: Weekday[]) => days.length > 0 || messages.workDaysRequired,
};

function isStaffFormField(field: unknown): field is 'name' | 'phone' | 'email' | 'locationId' | 'shiftStart' | 'shiftEnd' | 'reason' {
  return field === 'name' || field === 'phone' || field === 'email' || field === 'locationId' ||
    field === 'shiftStart' || field === 'shiftEnd' || field === 'reason';
}

export function getStaffFormError(error: unknown) {
  const data = (error as { response?: { data?: {
    code?: string;
    message?: string;
    errors?: Array<{ code?: string; field?: string; message?: string } | null>;
  } } } | null)?.response?.data;
  const issues = Array.isArray(data?.errors) ? data.errors : [];
  switch (issues[0]?.code ?? data?.code) {
    case 'PHONE_IN_USE': return { field: 'phone', message: messages.phoneInUse } as const;
    case 'EMAIL_IN_USE': return { field: 'email', message: messages.emailInUse } as const;
    case 'INVALID_PHONE': return { field: 'phone', message: messages.phoneFormat } as const;
    case 'INVALID_WORK_DAYS': return { field: 'workDays', message: messages.workDaysRequired } as const;
    case 'WORK_DAYS_CONFLICT': {
      const message = issues[0]?.message ?? data?.message;
      const titles = typeof message === 'string'
        ? message.match(/ has schedules on the days you removed: ("[\s\S]*")\. Change those schedules first\.$/)?.[1]
        : undefined;
      return { field: 'workDays', message: messages.workDaysConflict, values: { titles: titles ?? '—' } } as const;
    }
    case 'INVALID_REQUEST':
      for (const issue of issues) {
        if (isStaffFormField(issue?.field) && typeof issue.message === 'string' && issue.message.trim()) {
          return { field: issue.field, message: issue.message };
        }
      }
  }
  return undefined;
}
