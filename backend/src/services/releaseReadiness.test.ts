import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { releaseReadiness, releaseEvidenceGates } from './releaseReadiness.js';
import { requireLaunchPhotoQualification } from './verification-v2/launchQualification.js';
const root = new URL('../../', import.meta.url);
const workflow = readFileSync(new URL('../.github/workflows/ci.yml', root), 'utf8');
const runtime = { NODE_ENV: 'production', ACCESS_TOKEN_SECRET: 'test-access-7c45de0fab89123456789abcdef', REFRESH_TOKEN_SECRET: 'test-refresh-3b9ca8ef0123456789abcdef0', ACCESS_TOKEN_EXPIRY: '15m', REFRESH_TOKEN_EXPIRY: '7d', STAFF_REFRESH_TOKEN_EXPIRY: '30d', FRONTEND_URL: 'https://approved.example.invalid', COOKIE_SECURE: 'true', COOKIE_SAME_SITE: 'lax' };
afterEach(() => vi.unstubAllEnvs());
it('CI executes current direct-photo, qualification, review and full web/mobile regressions', () => {
  for (const path of ['directPhoto.service.test.ts', 'launchQualification.test.ts', 'reviewClosure.service.test.ts', 'launchPhotoPolicy.test.ts', 'scripts/launchCiDatabase.ts']) expect(workflow).toContain(path);
  for (const directory of ['backend', 'frontend', 'frontend-mobile']) expect(workflow).toContain(`working-directory: ${directory}`);
  expect(workflow.match(/run: npm test/g)?.length).toBe(3);
  expect(workflow).toContain('run: npm run typecheck'); expect(workflow).toContain('run: npm run build:web');
  expect(workflow).not.toContain('run: npm run test:verification:photo-http');
  expect(workflow).not.toContain('continue-on-error'); expect(workflow).toContain('push: false');
});
it('CI uses local disposable Postgres and all existing launch contract proofs', () => {
  expect(workflow).toContain('postgres:16-alpine'); expect(workflow).toContain('LAUNCH_CI_DATABASE_URL: postgresql://verification:verification-test-only@127.0.0.1:5432/priv_verification_test');
  const runner = readFileSync(new URL('scripts/launchCiDatabase.ts', root), 'utf8');
  for (const name of ['workforceLifecycle', 'accountCapacity', 'billingLifecycle', 'ownerIdentity', 'companySettings', 'attendanceAnnotation', 'platformCompany', 'platformSupport', 'launchPhoto', 'launchComposition']) expect(runner).toContain(`['${name}',`);
  expect(runner).toContain('assertIsolatedMediaDatabase(raw, process.env.NODE_ENV)');
  expect(runner).not.toContain('dotenv/config');
});
it.each([undefined, 'postgresql://user:secret@remote.example.invalid/prod', 'postgresql://user@127.0.0.1/customer', 'postgresql://user@127.0.0.1/customer_test'])('runner rejects unsafe/unowned bootstrap %s before connecting', raw => {
  const env = { ...process.env, NODE_ENV: 'test', ...(raw ? { LAUNCH_CI_DATABASE_URL: raw } : {}) }; if (!raw) delete env.LAUNCH_CI_DATABASE_URL;
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/launchCiDatabase.ts'], { cwd: fileURLToPath(root), env, encoding: 'utf8', timeout: 10000 });
  expect(result.status).not.toBe(0); expect(result.stderr).not.toContain('ECONNREFUSED'); expect(result.stderr).not.toContain('user:secret');
});
it('production configuration is actually validated even when current NODE_ENV is test', () => {
  expect(releaseReadiness({ NODE_ENV: 'test' }).productionConfiguration).toBe('INVALID'); expect(releaseReadiness(runtime).productionConfiguration).toBe('VALIDATED');
  expect(releaseReadiness({ ...runtime, COOKIE_SECURE: 'false' }).productionConfiguration).toBe('INVALID');
});
it('readiness output is redacted and never converts config/schema observations into release evidence', () => {
  const report = releaseReadiness(runtime, { ready: true }); expect(report).toMatchObject({ productionConfiguration: 'VALIDATED', schemaObservation: 'READY', releaseAllowed: false, providerConnectivity: 'NOT_CHECKED' });
  expect(releaseReadiness(runtime).schemaObservation).toBe('NOT_OBSERVED'); expect(releaseReadiness(runtime, { ready: false }).schemaObservation).toBe('NOT_READY');
  const serialized = JSON.stringify(report); for (const value of [runtime.ACCESS_TOKEN_SECRET, runtime.REFRESH_TOKEN_SECRET, runtime.FRONTEND_URL]) expect(serialized).not.toContain(value);
  expect(report.evidenceGates).toHaveLength(releaseEvidenceGates.length); expect(report.evidenceGates.every(gate => gate.status === 'REQUIRES_EVIDENCE')).toBe(true);
});
it.each(['AUTO_PASS_ENABLED', 'PHOTO_QUALIFIED', 'PRIVACY_SCREENING_ENABLED', 'RELEASE_APPROVED'])('a deployment flag %s cannot manufacture release or active photo qualification', name => {
  vi.stubEnv(name, 'true'); vi.stubEnv('CLEF_RELEASE_RECORD_PATH', ''); vi.stubEnv('CLEF_RELEASE_RECORD_SHA256', '');
  expect(releaseReadiness(runtime)).toMatchObject({ photoProcessing: 'UNAVAILABLE', automaticApproval: false, releaseAllowed: false }); expect(() => requireLaunchPhotoQualification('SINK')).toThrow(expect.objectContaining({ statusCode: 503 }));
});
it('restore/provider/device/old-media/fit/query gates have explicit evidence requirements', () => {
  const runbook = readFileSync(new URL('../docs/implementation/RELEASE_RUNBOOK.md', root), 'utf8');
  for (const id of releaseEvidenceGates) expect(runbook).toContain(id);
  expect(runbook).toContain('BOUNDED_LISTS_SPEC.md');
});
