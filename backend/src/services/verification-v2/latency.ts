type Identity = { taskId?: number; sessionId?: string; attemptId?: string; jobId?: string; stage?: string };
export function verificationEvent(event: string, ids: Identity, metrics: Record<string, unknown> = {}) {
  // Deliberately excludes GPS, QR/slot credentials, image bytes and provider prose.
  console.info(JSON.stringify({ type: 'VERIFICATION_TIMING', event, at: new Date().toISOString(), ...ids, ...metrics }));
}
export function jobTiming(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return {};
  const timing = (result as Record<string, unknown>).timing;
  return timing && typeof timing === 'object' && !Array.isArray(timing) ? timing as Record<string, unknown> : {};
}
