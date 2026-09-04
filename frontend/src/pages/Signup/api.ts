
import {client} from "../../api/client.js"
import type{ SignUpForm, AuthUser } from "./types.js";


export const signUp = async (data: SignUpForm): Promise<AuthUser> => {
  const res = await client.post('/manager/manager-signup', data, { withCredentials: true });
  return res.data.data;
};

/** Decode only the public signup transport contract; never use message text as a code. */
export function signupFailure(cause: unknown): {
  duplicate: boolean;
  retryAfter: number | null;
  fields: Partial<Record<keyof SignUpForm, string>>;
} {
  const response = (cause as { response?: { status?: number; headers?: Record<string, unknown>; data?: { code?: string; errors?: unknown } } } | null)?.response;
  const issues = Array.isArray(response?.data?.errors) ? response.data.errors : [];
  const duplicate = response?.data?.code === 'EMAIL_EXISTS' || issues.some(issue => issue?.code === 'EMAIL_EXISTS');
  const fields: Partial<Record<keyof SignUpForm, string>> = {};
  if (response?.status === 400) {
    for (const issue of issues) {
      if (issue && ['name', 'companyName', 'email', 'password'].includes(issue.field) && typeof issue.message === 'string') {
        fields[issue.field as keyof SignUpForm] = issue.message;
      }
    }
  }
  const seconds = Number(response?.headers?.['retry-after']);
  const retryAfter = response?.status === 429
    ? (Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null)
    : null;
  return { duplicate, retryAfter, fields };
}
