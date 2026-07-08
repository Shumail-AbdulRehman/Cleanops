import {reasonCodeSchema} from './contracts.js';
const record = (value: unknown): Record<string,unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
const names = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 100))].slice(0,20) : [];
/** Expose stored findings for manager explanations, never provider payloads/scores. */
export function reviewEvidenceSummary(raw: unknown) {
  const stored = record(raw), result = record(stored.result ?? stored), context = record(stored.photoContext);
  const reason = reasonCodeSchema.safeParse(stored.policyDecisionReason ?? result.reasonCode);
  const verdict = result.verdict === 'NEEDS_ATTENTION' ? 'DIRTY' : result.verdict;
  const surfaces = Array.isArray(result.surfaces) ? result.surfaces.map(record) : [];
  return {
    reasonCode: reason.success ? reason.data : null,
    cleanliness: typeof verdict === 'string' && ['CLEAN','DIRTY','CANNOT_ASSESS'].includes(verdict) ? verdict as 'CLEAN'|'DIRTY'|'CANNOT_ASSESS' : null,
    dirtySurfaces: names(surfaces.filter(surface => typeof surface.verdict === 'string' && ['DIRTY','NEEDS_ATTENTION'].includes(surface.verdict)).map(surface => surface.surface)),
    missingSurfaces: names(context.missingSurfaces),
  };
}
