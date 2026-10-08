import { client, staffSignInPaths } from '../api/client';
import type { ApiEnvelope, StaffUser } from '../types';

export type StaffCodeRequest = {
  phone: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
};

type StaffSignInSession = StaffUser & { accessToken: string; refreshToken: string };

export async function requestStaffCode(phone: string): Promise<StaffCodeRequest> {
  const response = await client.post<ApiEnvelope<StaffCodeRequest>>(staffSignInPaths.request, { phone });
  return response.data.data;
}

export async function verifyStaffCode(phone: string, code: string): Promise<StaffSignInSession> {
  const response = await client.post<ApiEnvelope<StaffSignInSession>>(staffSignInPaths.verify, { phone, code });
  return response.data.data;
}

const errorKeys: Readonly<Partial<Record<string, string>>> = {
  INVALID_PHONE: 'Enter a Pakistan mobile number, like 03001234567.',
  PHONE_NOT_REGISTERED: 'This number is not registered. Ask your manager to add you.',
  PHONE_DAILY_LIMIT: "This number has reached today's code limit. Try again tomorrow or ask your manager.",
  SMS_DAILY_LIMIT: 'Sign-in codes are used up for today. Ask your manager.',
  SMS_UNAVAILABLE: 'The code could not be sent. Try again in a few minutes.',
  AUTH_RATE_LIMITED: 'Too many attempts. Try again later.',
  INVALID_REQUEST: 'Enter the 6-digit code.',
  CODE_EXPIRED: 'This code has expired. Ask for a new code.',
  CODE_LOCKED: 'Too many wrong tries. Ask for a new code.',
  APP_UPDATE_REQUIRED: 'Update the Hygene Ops app to sign in with your phone number.',
};

type ErrorDetail = { code?: string; retryAfterSeconds?: number; attemptsLeft?: number };
type SignInError = { key: string; values?: Record<string, number>; retryAfterSeconds?: number };

export function staffSignInError(error: unknown): SignInError | undefined {
  const data = (error as { response?: { data?: { code?: string; errors?: ErrorDetail[] } } } | null)
    ?.response?.data;
  const detail = data?.errors?.[0];
  const code = detail?.code ?? data?.code;
  if (code === 'CODE_RESEND_WAIT') {
    const seconds = detail?.retryAfterSeconds ?? 0;
    return { key: 'Wait {seconds} seconds before asking for a new code.', values: { seconds }, retryAfterSeconds: seconds };
  }
  if (code === 'CODE_WRONG') {
    return { key: 'That code is not right. {n} tries left.', values: { n: detail?.attemptsLeft ?? 0 } };
  }
  if (code && Object.prototype.hasOwnProperty.call(errorKeys, code)) {
    const key = errorKeys[code];
    if (key) return { key };
  }
}

export function formatStaffPhone(phone: string): string {
  return phone.replace(/^\+92(3\d{2})(\d{7})$/, '0$1 $2');
}
