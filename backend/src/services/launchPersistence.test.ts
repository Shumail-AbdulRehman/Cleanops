import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { assertIsolatedMediaDatabase } from "./attendanceMediaTransition.service.js";

// Never fall back to the app's DATABASE_URL/.env. Explicitly local disposable DB
// is required for these SQL invariant tests; absence is a reported skip.
const url = process.env.LAUNCH_PERSISTENCE_TEST_DATABASE_URL;
if (url) assertIsolatedMediaDatabase(url);
const db = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000, query_timeout: 10_000 });
let company: number, otherCompany: number, owner: number, manager: number, staff: number, otherStaff: number, site: number, attendance: number;
const id = () => randomUUID();
async function insertReturning(sql: string, values: unknown[] = []) { return (await db.query(sql + " RETURNING id", values)).rows[0].id as number; }
async function rejected(sql: string, values: unknown[], code: string) {
  await db.query("SAVEPOINT expected_constraint");
  await expect(db.query(sql, values)).rejects.toMatchObject({ code });
  await db.query("ROLLBACK TO SAVEPOINT expected_constraint");
}
async function note(role = "ADMIN", actor = owner, tenant = company, reason = "Connection problem reported") {
  const noteId = id();
  await db.query('INSERT INTO "AttendanceAnnotation" (id,"companyId","attendanceId","actorRole","actorId",reason,"requestId") VALUES ($1,$2,$3,$4,$5,$6,$7)', [noteId, tenant, attendance, role, actor, reason, id()]);
  return noteId;
}

describe.skipIf(!url)("isolated launch persistence SQL invariants", () => {
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });
  beforeEach(async () => {
    await db.query("BEGIN");
    company = await insertReturning('INSERT INTO "Company" (name,"updatedAt") VALUES ($1,NOW())', ["Isolated synthetic company"]);
    otherCompany = await insertReturning('INSERT INTO "Company" (name,"updatedAt") VALUES ($1,NOW())', ["Isolated other company"]);
    owner = await insertReturning('INSERT INTO "Manager" (name,email,password,role,"companyId","updatedAt") VALUES ($1,$2,$3,\'ADMIN\',$4,NOW())', ["Test owner", id()+"@example.invalid", "test-hash-unused", company]);
    manager = await insertReturning('INSERT INTO "Manager" (name,email,password,role,"companyId","updatedAt") VALUES ($1,$2,$3,\'MANAGER\',$4,NOW())', ["Test manager", id()+"@example.invalid", "test-hash-unused", company]);
    site = await insertReturning('INSERT INTO "Location" (name,address,"companyId",latitude,longitude,"updatedAt") VALUES ($1,$2,$3,$4,$5,NOW())', ["Test site", "Synthetic", company, "31.5", "74.3"]);
    staff = await insertReturning('INSERT INTO "Staff" (name,email,password,"companyId","locationId","updatedAt") VALUES ($1,$2,$3,$4,$5,NOW())', ["Test staff", id()+"@example.invalid", "test-hash-unused", company, site]);
    otherStaff = await insertReturning('INSERT INTO "Staff" (name,email,password,"companyId","updatedAt") VALUES ($1,$2,$3,$4,NOW())', ["Other staff", id()+"@example.invalid", "test-hash-unused", otherCompany]);
    attendance = await insertReturning('INSERT INTO "Attendance" ("staffId","locationId",date,"expectedStart","expectedEnd","updatedAt") VALUES ($1,$2,NOW(),NOW(),NOW()+INTERVAL \'8 hours\',NOW())', [staff, site]);
  });
  afterEach(async () => { await db.query("ROLLBACK"); });

  it("preserves existing account defaults and leaves legacy emails unverified", async () => {
    const m = (await db.query('SELECT "credentialVersion","mustChangePassword","emailVerifiedAt" FROM "Manager" WHERE id=$1', [owner])).rows[0];
    expect(m).toEqual({ credentialVersion: 0, mustChangePassword: false, emailVerifiedAt: null });
    expect((await db.query('SELECT "operationalStatus","accountVersion","isActive" FROM "Company" WHERE id=$1', [company])).rows[0]).toEqual({ operationalStatus: "ACTIVE", accountVersion: 0, isActive: true });
  });
  it("stores only hashes, enforces purpose/principal binding and rejects another tenant's worker", async () => {
    const sql = 'INSERT INTO "CredentialToken" (id,"tokenHash",purpose,"companyId","staffId","expiresAt") VALUES ($1,$2,\'STAFF_ACCESS_HANDOFF\',$3,$4,NOW()+INTERVAL \'30 minutes\')';
    await db.query(sql, [id(), "a".repeat(64), company, staff]);
    await rejected(sql, [id(), "b".repeat(64), company, otherStaff], "23503");
    await rejected(sql, [id(), "plaintext-temporary-password", company, staff], "23514");
    await rejected(sql, [id(), "c".repeat(64), company, null], "23514");
    const columns = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='CredentialToken'")).rows.map(r => r.column_name);
    expect(columns).not.toContain("token"); expect(columns).not.toContain("password");
  });
  it("enforces unique token hash, positive lifetime and one conditional consumption", async () => {
    const tokenId = id();
    const sql = 'INSERT INTO "CredentialToken" (id,"tokenHash",purpose,"companyId","managerId","targetEmail","expiresAt") VALUES ($1,$2,\'RESET_OWNER_PASSWORD\',$3,$4,$5,$6)';
    const args = [tokenId, "d".repeat(64), company, owner, "test@example.invalid", new Date(Date.now()+60_000)];
    await db.query(sql, args);
    await rejected(sql, [id(), ...args.slice(1)], "23505");
    await rejected(sql, [id(), "e".repeat(64), company, owner, "test@example.invalid", new Date(0)], "23514");
    const consume = 'UPDATE "CredentialToken" SET "consumedAt"=NOW() WHERE id=$1 AND "consumedAt" IS NULL AND "expiresAt">NOW() RETURNING id';
    expect((await db.query(consume, [tokenId])).rowCount).toBe(1); expect((await db.query(consume, [tokenId])).rowCount).toBe(0);
  });
  it("persists attributed notes separately from captured attendance and rejects mutation/deletion", async () => {
    const captured = (await db.query('SELECT * FROM "Attendance" WHERE id=$1', [attendance])).rows[0];
    const noteId = await note();
    await rejected('UPDATE "AttendanceAnnotation" SET reason=$1 WHERE id=$2', ["rewritten", noteId], "23514");
    await rejected('DELETE FROM "AttendanceAnnotation" WHERE id=$1', [noteId], "23514");
    expect((await db.query('SELECT * FROM "Attendance" WHERE id=$1', [attendance])).rows[0]).toEqual(captured);
    expect((await db.query('SELECT reason,"actorRole","actorId" FROM "AttendanceAnnotation" WHERE id=$1', [noteId])).rows[0]).toEqual({ reason: "Connection problem reported", actorRole: "ADMIN", actorId: owner });
  });
  it("rejects cross-company, cross-worker, blank-reason and unassigned-manager annotations", async () => {
    const sql = 'INSERT INTO "AttendanceAnnotation" (id,"companyId","attendanceId","actorRole","actorId",reason,"requestId") VALUES ($1,$2,$3,$4,$5,$6,$7)';
    await rejected(sql, [id(), otherCompany, attendance, "STAFF", otherStaff, "wrong tenant", id()], "23514");
    await rejected(sql, [id(), company, attendance, "STAFF", otherStaff, "wrong worker", id()], "23514");
    await rejected(sql, [id(), company, attendance, "MANAGER", manager, "wrong site", id()], "23514");
    await rejected(sql, [id(), company, attendance, "ADMIN", owner, "   ", id()], "23514");
  });
  it("permits the worker's own note and assigned-site manager acknowledgement as a new immutable row", async () => {
    const parent = await note("STAFF", staff);
    await db.query('INSERT INTO "ManagerLocation" ("managerId","locationId") VALUES ($1,$2)', [manager, site]);
    const acknowledgement = id();
    await db.query('INSERT INTO "AttendanceAnnotation" (id,"companyId","attendanceId","actorRole","actorId",kind,reason,"requestId","parentId") VALUES ($1,$2,$3,\'MANAGER\',$4,\'ACKNOWLEDGEMENT\',$5,$6,$7)', [acknowledgement, company, attendance, manager, "Reviewed with worker", id(), parent]);
    expect((await db.query('SELECT count(*)::int AS count FROM "AttendanceAnnotation" WHERE "attendanceId"=$1', [attendance])).rows[0].count).toBe(2);
    await rejected('DELETE FROM "Attendance" WHERE id=$1', [attendance], "23503");
  });
  it("rolls back credential-version and annotation writes together without altering prior capture", async () => {
    await db.query("SAVEPOINT reversible_change"); await note();
    await db.query('UPDATE "Staff" SET "credentialVersion"="credentialVersion"+1 WHERE id=$1', [staff]);
    await db.query("ROLLBACK TO SAVEPOINT reversible_change");
    expect((await db.query('SELECT "credentialVersion" FROM "Staff" WHERE id=$1', [staff])).rows[0].credentialVersion).toBe(0);
    expect((await db.query('SELECT count(*)::int AS count FROM "AttendanceAnnotation" WHERE "attendanceId"=$1', [attendance])).rows[0].count).toBe(0);
  });
});
