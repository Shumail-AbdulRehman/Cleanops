import type { Request, Response } from "express";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { assertIsolatedMediaDatabase } from "../src/services/attendanceMediaTransition.service.js";

const url = process.env.CREDENTIAL_HANDOFF_TEST_DATABASE_URL;
assertIsolatedMediaDatabase(url, process.env.NODE_ENV);
process.env.DATABASE_URL = url;
process.env.ACCESS_TOKEN_SECRET = randomBytes(32).toString("hex");
process.env.REFRESH_TOKEN_SECRET = randomBytes(32).toString("hex");
process.env.ACCESS_TOKEN_EXPIRY = "15m";
process.env.REFRESH_TOKEN_EXPIRY = "7d";

const { prisma } = await import("../src/prisma/prisma.js");
const { registerCompany } = await import("../src/services/companyRegistration.service.js");
const { changeOwnPassword, signOutStaffEverywhere } = await import("../src/services/credentialHandoff.service.js");
const { generateAccessToken, generateRefreshToken } = await import("../src/utils/auth.js");
const { staffPushSession } = await import("../src/services/staff-notifications/session.js");
const { verifyJwt } = await import("../src/middlewares/auth.middleware.js");
const { refreshToken, logOut } = await import("../src/controllers/common.controller.js");
const request = (accessToken: string) => ({ cookies: {}, header: () => `Bearer ${accessToken}` } as unknown as Request);
const refreshRequest = (refreshToken: string) => ({ cookies: { refreshToken }, body: {}, header: () => undefined } as unknown as Request);
const hasStatus = (statusCode: number) => (error: unknown) => (error as { statusCode?: number }).statusCode === statusCode;
const suffix = randomUUID();

try {
  const owner = await registerCompany({
    name: "Synthetic owner", companyName: "Synthetic sign-out test", email: `${suffix}-owner@example.invalid`,
    password: randomBytes(32).toString("hex"),
  });
  const location = await prisma.location.create({
    data: { name: "Synthetic site", address: "Isolated fixture", latitude: "31", longitude: "74", companyId: owner.companyId },
  });
  const worker = await prisma.staff.create({
    data: {
      name: "Synthetic worker", email: `${suffix}-worker@example.invalid`, password: randomBytes(32).toString("hex"),
      companyId: owner.companyId, locationId: location.id,
    },
  });
  const manager = await prisma.manager.create({
    data: {
      name: "Site manager", email: `${suffix}-manager@example.invalid`, password: randomBytes(32).toString("hex"),
      companyId: owner.companyId, role: "MANAGER",
    },
  });
  const managerActor = { id: manager.id, role: "MANAGER" as const, companyId: owner.companyId };
  const workerActor = { id: worker.id, role: "STAFF" as const, companyId: owner.companyId };
  const oldAccess = generateAccessToken(worker, "STAFF");
  const oldRefresh = generateRefreshToken(worker, "STAFF");
  await prisma.staff.update({ where: { id: worker.id }, data: { refreshToken: oldRefresh } });
  const pushSession = staffPushSession(oldRefresh);
  assert.ok(pushSession);
  await prisma.staffPushDevice.createMany({
    data: ["android", "ios"].map(platform => ({
      id: randomUUID(), token: randomUUID(), staffId: worker.id, companyId: owner.companyId, platform, ...pushSession,
    })),
  });

  const ownerReason = "Synthetic worker requested sign-out";
  const managerReason = "Synthetic worker replaced their device";
  await assert.rejects(signOutStaffEverywhere(managerActor, worker.id, { reason: managerReason }), hasStatus(404));
  await assert.rejects(changeOwnPassword(workerActor, undefined), error => (
    hasStatus(403)(error) && (error as { errors: { code?: string }[] }).errors[0]?.code === "STAFF_PASSWORDS_RETIRED"
  ));
  let authorized = false;
  await verifyJwt(request(oldAccess), {} as Response, () => { authorized = true; });
  assert.equal(authorized, true);

  assert.deepEqual(await signOutStaffEverywhere(owner, worker.id, { reason: ownerReason }), { signedOut: true });
  await assert.rejects(verifyJwt(request(oldAccess), {} as Response, () => assert.fail("Revoked access authorized")), hasStatus(401));
  await assert.rejects(refreshToken(refreshRequest(oldRefresh), {} as Response), hasStatus(401));
  const signedOut = await prisma.staff.findUniqueOrThrow({ where: { id: worker.id } });
  assert.equal(signedOut.credentialVersion, worker.credentialVersion + 1);
  assert.equal(signedOut.refreshToken, null);
  assert.equal(signedOut.password, worker.password);
  assert.equal(signedOut.mustChangePassword, worker.mustChangePassword);
  const devices = await prisma.staffPushDevice.findMany({ where: { staffId: worker.id }, select: { enabled: true } });
  assert.deepEqual(devices, [{ enabled: false }, { enabled: false }]);

  await prisma.managerLocation.create({ data: { managerId: manager.id, locationId: location.id } });
  assert.deepEqual(await signOutStaffEverywhere(managerActor, worker.id, { reason: managerReason }), { signedOut: true });
  const signedOutAgain = await prisma.staff.findUniqueOrThrow({ where: { id: worker.id } });
  assert.equal(signedOutAgain.credentialVersion, signedOut.credentialVersion + 1);
  const audits = await prisma.auditLog.findMany({
    where: { companyId: owner.companyId, entityType: "STAFF", entityId: worker.id, action: "STAFF_SIGNED_OUT_EVERYWHERE" },
    select: { actorType: true, actorId: true, reason: true, newValue: true },
  });
  assert.equal(audits.length, 2);
  assert.deepEqual(audits.find(audit => audit.actorType === "ADMIN"), {
    actorType: "ADMIN", actorId: owner.id, reason: ownerReason, newValue: { sessionsRevoked: true },
  });
  assert.deepEqual(audits.find(audit => audit.actorType === "MANAGER"), {
    actorType: "MANAGER", actorId: manager.id, reason: managerReason, newValue: { sessionsRevoked: true },
  });

  const logoutAccess = generateAccessToken(signedOutAgain, "STAFF");
  const logoutRefresh = generateRefreshToken(signedOutAgain, "STAFF");
  await prisma.staff.update({ where: { id: worker.id }, data: { refreshToken: logoutRefresh } });
  const response = { clearCookie() { return this; }, status() { return this; }, json() { return this; } } as unknown as Response;
  await logOut(refreshRequest(logoutRefresh), response);
  await assert.rejects(verifyJwt(request(logoutAccess), {} as Response, () => assert.fail("Signed-out access authorized")), hasStatus(401));
  console.log("PASS isolated PostgreSQL staff sign-out: owner and manager scope, access and refresh revocation, disabled push devices, audit and password retirement.");
} finally {
  await prisma.$disconnect();
}
