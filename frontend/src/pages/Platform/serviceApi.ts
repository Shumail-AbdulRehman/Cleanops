import { operatorRequest } from './operatorSession';

export type HandlingStatus = 'NEW' | 'IN_PROGRESS' | 'CLOSED';
export type Handling = { version: number; status: HandlingStatus; owner: null | { issuer: string; subject: string }; updatedAt: string | null };
export type Inquiry = { id: string; company: string; requestedLocations: number; requestedStaff: number; createdAt: string; contactVerification: 'UNVERIFIED'; handling: Handling };
export type InquiryDetail = Inquiry & { contactName: string; contactEmail: string; requirements: string };
export type Diagnostics = { observedAt: string; identityConfigured: boolean; supportContactAvailable: boolean; providerConnectivity: 'NOT_CHECKED'; database: 'REACHABLE' | 'UNAVAILABLE'; observations: null | { lastWebhookOccurredAt: string | null; lastWebhookProcessedAt: string | null; lastWorkerHeartbeatAt: string | null } };
export type AuditAction = 'COMPANY_SUSPENDED' | 'COMPANY_REACTIVATED' | 'INQUIRY_UPDATED';
export type AuditRow = { id: number; companyId: number | null; action: AuditAction; actorType: 'PLATFORM_OPERATOR'; createdAt: string };
export type SupportContact = { available: boolean; email: string | null; channel: 'EMAIL' | null; verification: 'UNAVAILABLE' | 'OPERATOR_CONFIGURED' };
type Page<T> = { items: T[]; nextCursor: string | null };
async function get<T>(path: string, signal?: AbortSignal) { return (await operatorRequest<{ data: T }>(path, { signal })).data; }
function params(filters: Record<string, string | undefined>) { return new URLSearchParams({ limit: '25', ...Object.fromEntries(Object.entries(filters).filter(([, value]) => !!value)) }); }
export const getDiagnostics = (signal?: AbortSignal) => get<Diagnostics>('/platform/service/diagnostics', signal);
export const getSupportContact = (signal?: AbortSignal) => get<SupportContact>('/support/contact', signal);
export const getAudit = (filters: { companyId?: string; action?: string; after?: string }, signal?: AbortSignal) => get<Page<AuditRow>>(`/platform/service/audit?${params(filters)}`, signal);
export const getInquiries = (filters: { q?: string; after?: string }, signal?: AbortSignal) => get<Page<Inquiry>>(`/platform/service/inquiries?${params(filters)}`, signal);
export const getInquiry = (id: string, signal?: AbortSignal) => get<InquiryDetail>(`/platform/service/inquiries/${encodeURIComponent(id)}`, signal);
export async function saveInquiry(id: string, body: { expectedVersion: number; status: HandlingStatus; ownership: 'SELF' | 'UNASSIGNED'; reason: string }) {
  return (await operatorRequest<{ data: { handling: Handling; changed: boolean } }>(`/platform/service/inquiries/${encodeURIComponent(id)}`, { method: 'PATCH', body })).data;
}
