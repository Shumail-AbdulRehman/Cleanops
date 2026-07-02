import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { assertIsolatedMediaDatabase } from '../src/services/attendanceMediaTransition.service.js';

// No dotenv import or application-selected URL. This creates and owns a new DB.
const raw = process.env.LAUNCH_CI_DATABASE_URL;
assertIsolatedMediaDatabase(raw, process.env.NODE_ENV);
const source = new URL(raw!);
if (source.pathname !== '/priv_verification_test') throw new Error('Explicit disposable CI bootstrap database required');
const database = `priv_verification_test_launch_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client({ connectionString: source.href });
await admin.connect();
let created = false;
try {
  await admin.query(`CREATE DATABASE "${database}"`); created = true;
  const target = new URL(source); target.pathname = `/${database}`;
  const sql = new pg.Client({ connectionString: target.href });
  await sql.connect();
  try {
    const root = new URL('../prisma/migrations/', import.meta.url);
    for (const name of (await readdir(root)).filter(name => /^\d/.test(name)).sort()) {
      await sql.query(await readFile(new URL(`${name}/migration.sql`, root), 'utf8'));
    }
  } finally { await sql.end(); }
  const checks = [
    ['workforceLifecycle', 'WORKFORCE_LIFECYCLE_TEST_DATABASE_URL'], ['accountCapacity', 'ACCOUNT_CAPACITY_TEST_DATABASE_URL'],
    ['billingLifecycle', 'BILLING_LIFECYCLE_TEST_DATABASE_URL'], ['ownerIdentity', 'OWNER_IDENTITY_TEST_DATABASE_URL'],
    ['companySettings', 'COMPANY_SETTINGS_TEST_DATABASE_URL'], ['attendanceAnnotation', 'ATTENDANCE_ANNOTATION_TEST_DATABASE_URL'],
    ['platformCompany', 'PLATFORM_COMPANY_TEST_DATABASE_URL'], ['platformSupport', 'PLATFORM_SUPPORT_TEST_DATABASE_URL'],
    ['launchPhoto', 'LAUNCH_PHOTO_TEST_DATABASE_URL'], ['launchComposition', 'LAUNCH_COMPOSITION_TEST_DATABASE_URL'],
  ];
  for (const [name, variable] of checks) {
    console.log(`Isolated launch check: ${name}`);
    const result = spawnSync(process.execPath, ['--import', 'tsx', `tests/${name}.integration.ts`], {
      cwd: new URL('../', import.meta.url), stdio: 'inherit', timeout: 120000,
      env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: target.href, DIRECT_URL: target.href, [variable!]: target.href },
    });
    if (result.error || result.status !== 0) throw new Error(`Isolated launch check failed: ${name}`);
  }
  const persistence = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'src/services/launchPersistence.test.ts'], {
    cwd: new URL('../', import.meta.url), stdio: 'inherit', timeout: 120000,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: target.href, DIRECT_URL: target.href, LAUNCH_PERSISTENCE_TEST_DATABASE_URL: target.href },
  });
  if (persistence.error || persistence.status !== 0) throw new Error('Isolated persistence invariant check failed');
} finally {
  // Only this invocation's generated database can be dropped; never the bootstrap DB.
  try { if (created) await admin.query(`DROP DATABASE "${database}"`); } finally { await admin.end(); }
}
