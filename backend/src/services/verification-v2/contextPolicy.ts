export type ContextKey = 'ENTRANCE' | 'LAYOUT';
export const CURRENT_CONTEXT_KEYS: ContextKey[] = [];

/** Persisted per session so renewing an older capture cannot erase its obligations. */
export function requiredContextKeys(locationCheck: unknown): ContextKey[] {
  const policy = (locationCheck as {captureContextPolicy?: {version?: unknown; requiredKeys?: unknown}} | null)?.captureContextPolicy;
  if (policy?.version === 2 && Array.isArray(policy.requiredKeys) && policy.requiredKeys.length === 0) return [];
  if (policy?.version === 1 && Array.isArray(policy.requiredKeys) &&
      policy.requiredKeys.length > 0 && policy.requiredKeys.includes('ENTRANCE') &&
      policy.requiredKeys.every(key => key === 'ENTRANCE' || key === 'LAYOUT') &&
      new Set(policy.requiredKeys).size === policy.requiredKeys.length) {
    return [...policy.requiredKeys] as ContextKey[];
  }
  // Missing/malformed policies are legacy, never a reason to weaken authority.
  return ['ENTRANCE', 'LAYOUT'];
}

export function captureContextPolicy(keys: ContextKey[]) {
  return {version: keys.length === 0 ? 2 : 1, requiredKeys: [...keys]};
}
