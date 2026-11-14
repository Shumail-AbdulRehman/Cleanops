import type { Account } from './types';

let scope: string | null = null;
export function setCaptureAccount(account: Account | null) {
  scope=account?`${account.companyId}_${account.id}`:null;
}
export function captureAccount() { return scope; }
