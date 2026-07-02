import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { planPlatformDemo, runPlatformDemoSeed } from './platformDemoSeed.js';

// Reuse Prisma's bundled PGlite without its Emscripten types. The pg adapter
// still builds and decodes its normal queries, but the pool never opens sockets.
const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
const db: {
  exec(sql: string): Promise<unknown>;
  query<T>(sql: string, values?: unknown[], options?: { rowMode: 'array' }): Promise<{
    rows: T[];
    fields: { name: string; dataTypeID: number }[];
    affectedRows: number;
  }>;
  close(): Promise<void>;
} = new PGlite();

async function query(config: string | pg.QueryArrayConfig, values?: unknown[]) {
  const { text, values: params, rowMode } = typeof config === 'string' ? { text: config } : config;
  const result = await db.query(text, values ?? params, rowMode === 'array' ? { rowMode } : undefined);
  return { ...result, rowCount: result.affectedRows };
}

function openClient() {
  const pool = new pg.Pool();
  const client = Object.assign(new pg.Client(), { query, release: () => {} });
  type CheckoutCallback = Parameters<pg.Pool['connect']>[0];
  // Support both the adapter's promise-based checkout and pg's callback form.
  function checkout(): Promise<pg.PoolClient>;
  function checkout(callback: CheckoutCallback): void;
  function checkout(callback?: CheckoutCallback): Promise<pg.PoolClient> | void {
    if (callback) {
      callback(undefined, client, client.release);
      return;
    }
    return Promise.resolve(client);
  }
  vi.spyOn(pool, 'connect').mockImplementation(checkout);
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

const now = new Date('2026-11-20T13:00:00Z');
const catalog = [
  { plan: 'STARTER', interval: 'month', priceId: 'pri_00000000000000000000000000' },
  { plan: 'PRO', interval: 'year', priceId: 'pri_00000000000000000000000001' },
  { plan: 'ADVANCED', interval: 'month', priceId: 'pri_00000000000000000000000002' },
] as const;
const env = {
  DATABASE_URL: 'postgresql://demo:demo@127.0.0.1:56445/hygene_ops_local',
  PADDLE_ENVIRONMENT: 'sandbox',
  PADDLE_PRICE_CATALOG_JSON: JSON.stringify(catalog),
};
const run = (mode: '--apply' | '--remove', print = vi.fn()) =>
  runPlatformDemoSeed([mode], env, { connect: async () => openClient(), now: () => now, print });

beforeAll(async () => {
  const migrations = new URL('../prisma/migrations/', import.meta.url);
  const entries = await readdir(migrations, { withFileTypes: true });
  for (const migration of entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()) {
    await db.exec(await readFile(new URL(`${migration}/migration.sql`, migrations), 'utf8'));
  }
}, 30_000);

afterAll(() => db.close());

it('applies the plan once and removes only marked rows on the migrated schema', async () => {
  const existing = await db.query<{ id: number }>(
    'INSERT INTO "Company" ("name", "updatedAt") VALUES ($1, CURRENT_TIMESTAMP) RETURNING *',
    ['Platform Demo 28 - Existing company outside the reserved range'],
  );
  const tables = {
    companies: 'Company', locations: 'Location', managers: 'Manager', staff: 'Staff',
    customers: 'PaddleCustomer', subscriptions: 'PaddleSubscription', transactions: 'PaddleTransaction',
    tasks: 'TaskInstance', attendance: 'Attendance', areas: 'Area', areaItems: 'AreaItem',
    assignments: 'TaskAssignment', verificationItems: 'TaskVerificationItem',
    requirements: 'TaskEvidenceRequirement', sessions: 'CaptureSession', slots: 'CaptureSlot',
    attempts: 'VerificationAttempt',
  } satisfies Record<keyof ReturnType<typeof planPlatformDemo>, string>;
  const plan = planPlatformDemo(now, catalog);
  const expectedCounts = Object.fromEntries(Object.entries(plan).map(([key, rows]) => [key, rows.length]));
  async function expectCounts(applied: boolean, extraTransactions = 0) {
    for (const [key, table] of Object.entries(tables)) {
      const { rows } = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM "${table}"`);
      const existingCount = table === 'Company' ? 1 : table === 'PaddleTransaction' ? extraTransactions : 0;
      expect(rows[0].count, table).toBe((applied ? expectedCounts[key] : 0) + existingCount);
    }
  }

  await run('--apply');
  await expectCounts(true);
  const subscriptions = await db.query<{ id: string; priceId: string }>('SELECT id, "priceId" FROM "PaddleSubscription"');
  expect(new Map(subscriptions.rows.map(row => [row.id, row.priceId]))).toEqual(
    new Map(plan.subscriptions.map(row => [row.id, row.priceId])),
  );
  expect(new Set(subscriptions.rows.map(row => row.priceId))).toEqual(new Set(catalog.map(entry => entry.priceId)));

  const photos = await db.query<{ id: string; state: string }>(`
    SELECT a.id, a.state FROM "VerificationAttempt" a
    JOIN "CaptureSlot" s ON s.id = a."slotId" AND s."attemptId" = a.id
    JOIN "TaskEvidenceRequirement" r ON r.id = a."requirementId" AND r."currentAttemptId" = a.id
    WHERE a."mediaAssetId" IS NULL
  `);
  expect(new Map(photos.rows.map(row => [row.id, row.state]))).toEqual(
    new Map(plan.attempts.map(row => [row.id, row.state])),
  );

  await expect(run('--apply')).rejects.toThrow('Demo rows already exist');
  await expectCounts(true);

  // An underscore wildcard would incorrectly match and delete this linked row.
  const blocker = await db.query(`
    INSERT INTO "PaddleTransaction" (id, "companyId", status, "currencyCode", "paddleUpdatedAt", "lastEventAt", "updatedAt")
    VALUES ($1, $2, 'draft', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *
  `, ['demoXplatform28Yunmarked', plan.companies[0].id]);
  await expect(run('--remove')).rejects.toThrow('Demo removal rolled back');
  await expectCounts(true, 1);
  expect((await db.query('SELECT * FROM "PaddleTransaction" WHERE id = $1', ['demoXplatform28Yunmarked'])).rows)
    .toEqual(blocker.rows);
  await db.query('DELETE FROM "PaddleTransaction" WHERE id = $1', ['demoXplatform28Yunmarked']);

  const print = vi.fn();
  await run('--remove', print);
  await expectCounts(false);
  expect(JSON.parse(print.mock.calls[0][0].slice('Removed '.length))).toEqual(expectedCounts);
  expect((await db.query('SELECT * FROM "Company"')).rows).toEqual(existing.rows);
  expect((await db.query(`
    SELECT tgname, tgenabled FROM pg_trigger
    WHERE tgname IN ('retain_attempt', 'immutable_requirement', 'immutable_task_item')
    ORDER BY tgname
  `)).rows).toEqual([
    { tgname: 'immutable_requirement', tgenabled: 'O' },
    { tgname: 'immutable_task_item', tgenabled: 'O' },
    { tgname: 'retain_attempt', tgenabled: 'O' },
  ]);
  const next = await db.query<{ id: number }>(
    'INSERT INTO "Company" ("name", "updatedAt") VALUES ($1, CURRENT_TIMESTAMP) RETURNING id',
    ['Next ordinary company'],
  );
  expect(next.rows[0].id).toBe(existing.rows[0].id + 1);
}, 90_000);
