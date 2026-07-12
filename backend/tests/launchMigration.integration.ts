import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertIsolatedMediaDatabase } from "../src/services/attendanceMediaTransition.service.js";
const url = process.env.LAUNCH_MIGRATION_TEST_DATABASE_URL;
assertIsolatedMediaDatabase(url, process.env.NODE_ENV);
const db = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000, query_timeout: 30_000 });
const directory = fileURLToPath(new URL("../prisma/migrations/", import.meta.url));
const launch = "202610200001_launch_lifecycle";
try {
  await db.connect();
  assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")).rows[0].n, 0, "Refusing non-empty rehearsal database");
  for (const migration of (await readdir(directory)).filter(name => /^\d/.test(name) && name < launch).sort()) await db.query(await readFile(`${directory}/${migration}/migration.sql`, "utf8"));
  const create = async (sql: string, values: unknown[] = []) => (await db.query(sql+" RETURNING id", values)).rows[0].id as number;
  const company = await create('INSERT INTO "Company" (name,"isActive","updatedAt") VALUES (\'Legacy synthetic company\',false,NOW())');
  await create('INSERT INTO "Manager" (name,email,password,role,"companyId","updatedAt") VALUES (\'Legacy owner\',\'legacy@example.invalid\',\'synthetic-hash\',\'ADMIN\',$1,NOW())', [company]);
  const site = await create('INSERT INTO "Location" (name,address,"companyId",latitude,longitude,"updatedAt") VALUES (\'Legacy site\',\'Synthetic\',$1,\'31\',\'74\',NOW())', [company]);
  const staff = await create('INSERT INTO "Staff" (name,email,password,"companyId","locationId","updatedAt") VALUES (\'Legacy worker\',\'worker@example.invalid\',\'synthetic-worker-hash\',$1,$2,NOW())', [company, site]);
  await create('INSERT INTO "Attendance" ("staffId","locationId",date,"expectedStart","expectedEnd","checkInTime",status,"checkInImage","updatedAt") VALUES ($1,$2,NOW(),NOW(),NOW()+INTERVAL \'8 hours\',NOW(),\'CHECKED_IN\',\'legacy-reference-preserved\',NOW())', [staff, site]);
  const tables = ["Company", "Manager", "Staff", "Attendance"];
  const before: Record<string, pg.QueryResultRow[]> = {};
  for (const table of tables) before[table] = (await db.query(`SELECT * FROM "${table}" ORDER BY id`)).rows;
  const sql = await readFile(`${directory}/${launch}/migration.sql`, "utf8");
  await db.query("BEGIN"); await db.query(sql);
  assert.equal((await db.query('SELECT "operationalStatus" FROM "Company" WHERE id=$1', [company])).rows[0].operationalStatus, "SUSPENDED");
  await db.query("ROLLBACK");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='Manager' AND column_name='credentialVersion'")).rows[0].n, 0);
  for (const table of tables) assert.deepEqual((await db.query(`SELECT * FROM "${table}" ORDER BY id`)).rows, before[table]);
  await db.query("BEGIN"); await db.query(sql); await db.query("COMMIT");
  for (const table of tables) {
    const actual = (await db.query(`SELECT * FROM "${table}" ORDER BY id`)).rows;
    assert.equal(actual.length, before[table].length);
    for (let n=0; n<actual.length; n++) for (const [key,value] of Object.entries(before[table][n])) assert.deepEqual(actual[n][key],value, `${table}.${key} must be preserved`);
  }
  assert.deepEqual((await db.query('SELECT "credentialVersion","mustChangePassword","emailVerifiedAt" FROM "Manager"')).rows[0], { credentialVersion: 0, mustChangePassword: false, emailVerifiedAt: null });
  assert.equal((await db.query('SELECT "operationalStatus" FROM "Company" WHERE id=$1', [company])).rows[0].operationalStatus, "SUSPENDED");
  // Verify the existing registration boundary against real PostgreSQL and the
  // actual extended Prisma client, not a mock of transaction/hash behavior.
  process.env.DATABASE_URL = url;
  const { prisma } = await import("../src/prisma/prisma.js");
  const { registerCompany } = await import("../src/services/companyRegistration.service.js");
  const bcrypt = await import("bcrypt");
  try {
    const input = { companyName: "Concurrent synthetic registration", name: "Test owner", email: "concurrent-owner@example.invalid", password: "synthetic-test-password" };
    const countBefore = (await db.query('SELECT count(*)::int AS n FROM "Company"')).rows[0].n;
    const outcomes = await Promise.allSettled([registerCompany(input), registerCompany(input)]);
    assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter(result => result.status === "rejected").length, 1);
    const stored = await prisma.manager.findUniqueOrThrow({ where: { email: input.email } });
    assert.equal(await bcrypt.compare(input.password, stored.password), true, "Transaction password extension hashes exactly once");
    assert.notEqual(stored.password, input.password);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "Company"')).rows[0].n, countBefore + 1, "Duplicate signup leaves no orphan company");
  } finally { await prisma.$disconnect(); }
  console.log("PASS isolated PostgreSQL: existing migration chain, seeded account/workforce/attendance preservation, transactional rollback and reapply, safe inactive-company default, real concurrent signup/no orphan and exactly-once password hashing.");
} finally { await db.end(); }
