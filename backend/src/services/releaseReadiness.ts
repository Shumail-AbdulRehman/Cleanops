import { validateRuntimeSecurity } from '../config/runtimeSecurity.js';
import { launchQualificationStatus } from './verification-v2/launchQualification.js';

/** Human release evidence is deliberately separate from runtime flags/observations. */
export const releaseEvidenceGates = [
  'tls-and-origin', 'secret-custody-and-job-owner', 'migration-backup-rollback-restore',
  'paddle-merchant-catalog-sandbox', 'owner-delivery-and-legacy-bootstrap', 'operator-idp-mfa-browser',
  'verified-support-and-approved-policies', 'signed-android-and-physical-device', 'old-private-media-transition',
  'representative-consented-photo-privacy-identity', 'customer-calendar-and-fit', 'bounded-query-scale',
] as const;
export function releaseReadiness(env: NodeJS.ProcessEnv = process.env, schemaObservation?: { ready: boolean }) {
  let productionConfiguration: 'VALIDATED' | 'INVALID' = 'INVALID';
  try { validateRuntimeSecurity({ ...env, NODE_ENV: 'production' }); productionConfiguration = 'VALIDATED'; } catch { /* Report no names/values/secrets. */ }
  const photo = launchQualificationStatus('SINK');
  return {
    productionConfiguration,
    schemaObservation: schemaObservation ? schemaObservation.ready ? 'READY' as const : 'NOT_READY' as const : 'NOT_OBSERVED' as const,
    photoProcessing: photo.processingAllowed ? 'QUALIFIED_ADAPTER' as const : 'UNAVAILABLE' as const,
    automaticApproval: photo.automaticApproval,
    providerConnectivity: 'NOT_CHECKED' as const,
    releaseAllowed: false as const,
    evidenceGates: releaseEvidenceGates.map(id => ({ id, status: 'REQUIRES_EVIDENCE' as const })),
  };
}
