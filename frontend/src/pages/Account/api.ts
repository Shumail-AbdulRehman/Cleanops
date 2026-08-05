import { client } from '@/api/client';
export interface OwnerIdentityStatus { emailVerified: boolean; deliveryConfigured: boolean; bootstrapRequired: boolean }
export interface CompanySettings { id: number; name: string; accountVersion: number; updatedAt: string }
export const ownerStatus = async () => (await client.get('/owner-identity/status')).data.data as OwnerIdentityStatus;
export const companySettings = async () => (await client.get('/company/settings')).data.data as CompanySettings;
export const saveCompanySettings = async (name: string, expectedVersion: number) => (await client.patch('/company/settings', {name, expectedVersion})).data.data as {company: CompanySettings; changed: boolean};
export const requestRecovery = async (email: string) => (await client.post('/owner-identity/recovery/request', {email})).data.data;
export const requestVerification = async (currentPassword: string) => (await client.post('/owner-identity/email/request', {currentPassword})).data.data;
export const changePassword = async (currentPassword: string, newPassword: string) => (await client.post('/common/security/password', {currentPassword, newPassword})).data.data;
export const completeOwnerLink = async (kind: 'verify' | 'reset', token: string, newPassword?: string) => (await client.post(kind === 'verify' ? '/owner-identity/email/complete' : '/owner-identity/recovery/complete', kind === 'verify' ? {token} : {token, newPassword})).data.data;
export function responseStatus(error: unknown): number | undefined { return (error as {response?: {status?: number}})?.response?.status; }
export function requiresPasswordChange(error: unknown): boolean {
 const data = (error as {response?: {status?: number; data?: {errors?: Array<{code?: string}>}}})?.response;
 return data?.status === 403 && data.data?.errors?.some(item => item.code === 'PASSWORD_CHANGE_REQUIRED') === true;
}
