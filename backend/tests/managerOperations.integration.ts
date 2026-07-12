import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
const source = process.env.VERIFICATION_TEST_DATABASE_URL;
if (!source) throw new Error("Isolated local test URL required");
const url = new URL(source);
if (
  url.hostname !== "127.0.0.1" ||
  !url.pathname.startsWith("/priv_verification_test")
)
  throw new Error("Only isolated local test database is permitted");
const database = `priv_verification_test_manager_${Date.now()}`;
const admin = new pg.Client({ connectionString: source });
await admin.connect();
await admin.query(`CREATE DATABASE "${database}"`);
await admin.end();
url.pathname = "/" + database;
process.env.DATABASE_URL = url.toString();
process.env.NODE_ENV = "test";
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
const root = new URL("../prisma/migrations/", import.meta.url);
for (const name of (await readdir(root)).filter((n) => /^\d/.test(n)).sort())
  await client.query(
    await readFile(new URL(`${name}/migration.sql`, root), "utf8"),
  );
await client.end();
const { prisma } = await import("../src/prisma/prisma.js");
const { managerOperations } =
  await import("../src/services/managerOperations.service.js");
const { operationsQuery } =
  await import("../src/services/operationsScope.service.js");
const { countReviews, listReviews } = await import("../src/services/reviewList.service.js");
const { dashboardTrends } = await import("../src/services/dashboardTrends.service.js");
const { issueSatisfied } =
  await import("../src/services/verification-v2/exception.service.js");
const now = new Date("2026-10-11T19:15:00Z");
const company = await prisma.company.create({
  data: { name: "Manager integration", subscriptionStatus: "ACTIVE" },
});
// Current account policy uses provider-mirrored entitlement, not legacy subscriptionStatus.
// Synthetic rows/catalog are local to this newly created disposable database.
const billingNow = new Date(), priceId = 'pri_00000000000000000000000001';
process.env.PADDLE_ENVIRONMENT = 'sandbox';
process.env.PADDLE_PRICE_CATALOG_JSON = JSON.stringify([{plan:'STARTER',interval:'month',priceId}]);
const customerId = `ctm_manager_fixture_${company.id}`, subscriptionId = `sub_manager_fixture_${company.id}`;
await prisma.paddleCustomer.create({data:{id:customerId,companyId:company.id,status:'active',paddleUpdatedAt:billingNow,lastEventAt:billingNow}});
await prisma.paddleSubscription.create({data:{id:subscriptionId,customerId,companyId:company.id,status:'active',priceId,productId:'pro_manager_fixture',currentBillingPeriodStart:new Date(+billingNow-3600000),currentBillingPeriodEnd:new Date(+billingNow+3600000),paddleUpdatedAt:billingNow,lastEventAt:billingNow}});
await prisma.company.update({where:{id:company.id},data:{billingCustomerId:customerId,billingSubscriptionId:subscriptionId}});
const foreign = await prisma.company.create({ data: { name: "Other tenant" } });
const location = await prisma.location.create({
  data: {
    name: "Karachi",
    address: "Test",
    companyId: company.id,
    timezone: "Asia/Karachi",
    latitude: "0",
    longitude: "0",
  },
});
const other = await prisma.location.create({
  data: {
    name: "Unassigned location",
    address: "Test",
    companyId: company.id,
    timezone: "Asia/Karachi",
    latitude: "0",
    longitude: "0",
  },
});
const manager = await prisma.manager.create({
  data: {
    name: "Manager",
    email: randomUUID() + "@test.invalid",
    password: "test-only",
    companyId: company.id,
    role: "MANAGER",
    assignedLocations: { create: { locationId: location.id } },
  },
});
const actor = {
  id: manager.id,
  role: "MANAGER" as const,
  companyId: company.id,
};
const staff = await prisma.staff.create({
  data: {
    name: "Ali",
    email: randomUUID() + "@test.invalid",
    password: "test-only",
    companyId: company.id,
    locationId: location.id,
  },
});
await prisma.attendance.create({
  data: {
    staffId: staff.id,
    locationId: location.id,
    date: new Date("2026-10-10T19:00:00Z"),
    expectedStart: new Date("2026-10-11T17:00:00Z"),
    expectedEnd: new Date("2026-10-12T01:00:00Z"),
    status: "MISSED_CHECKOUT",
    checkInTime: new Date("2026-10-11T17:00:00Z"),
  },
});
async function task(
  title: string,
  start: string,
  end: string,
  extra: Record<string, unknown> = {},
) {
  return prisma.taskInstance.create({
    data: {
      title,
      locationId: location.id,
      date: new Date(start),
      shiftStart: new Date(start),
      shiftEnd: new Date(end),
      ...extra,
    },
  });
}
await task("Old ended task", "2026-10-10T10:00:00Z", "2026-10-10T11:00:00Z", {
  staffId: staff.id,
});
const overnight = await task(
  "Night carry-over",
  "2026-10-11T17:00:00Z",
  "2026-10-12T01:00:00Z",
  { staffId: staff.id, status: "IN_PROGRESS" },
);
const previouslyAssigned = await task("No worker today", "2026-10-11T19:01:00Z", "2026-10-11T19:10:00Z", { status: "MISSED" });
await prisma.taskAssignment.createMany({ data: [
  { taskInstanceId: previouslyAssigned.id, staffId: staff.id, status: "CANCELLED", isCurrent: false, assignedAt: new Date("2026-10-11T18:00:00Z") },
  { taskInstanceId: previouslyAssigned.id, staffId: staff.id, status: "MISSED", isCurrent: false, assignedAt: new Date("2026-10-11T19:01:00Z") },
] });
await task(
  "Submitted but not verified",
  "2026-10-11T19:01:00Z",
  "2026-10-11T19:10:00Z",
  {
    staffId: staff.id,
    status: "IN_PROGRESS",
    staffSubmittedAt: new Date("2026-10-11T19:09:00Z"),
  },
);
const overview = (await managerOperations(
  actor,
  operationsQuery.parse({ date: "2026-10-12" }),
  "overview",
  now,
)) as any;
assert.equal(overview.metrics.totalTasks, 3);
assert.equal(overview.metrics.submitted, 1);
assert.equal(overview.metrics.present, 1);
assert.equal(overview.metrics.scheduled, 1);
assert.equal(overview.metrics.verified, 0);
assert.deepEqual(overview.comparison[0], {
  location: overview.selected[0], present: 1, scheduled: 1, tasks: 3, submitted: 1, reviews: 0,
});
assert.ok(overview.tasks.every((t: any) => t.shiftStart instanceof Date));
assert.equal(overview.tasks.find((t: any) => t.id === overnight.id)?.carryOver, true);
assert.equal(
  Object.values(overview.chart).reduce((a: any, b: any) => a + b, 0),
  3,
);
const tasks = (await managerOperations(
  actor,
  operationsQuery.parse({ date: "2026-10-12" }),
  "tasks",
  now,
)) as any;
assert.equal(
  tasks.rows.find((r: any) => r.id === overnight.id).carryOver,
  true,
);
assert.equal(
  tasks.rows.some((r: any) => r.title === "Old ended task"),
  false,
);
for (const rows of [overview.tasks, tasks.rows]) {
  const historical = rows.find((row: any) => row.id === previouslyAssigned.id);
  assert.equal(historical.staffId, null);
  assert.equal(historical.staff, null);
  assert.equal(historical.assignments.length, 1);
  assert.equal(historical.assignments[0].staff.name, "Ali");
  assert.equal(historical.assignments[0].status, "MISSED");
  assert.equal(historical.assignments[0].isCurrent, false);
}
const workerRows = (await managerOperations(
  actor,
  operationsQuery.parse({ date: "2026-10-12", attendance: "present" }),
  "staff",
  now,
)) as any;
assert.equal(workerRows.total, 1);
assert.equal(workerRows.rows[0].submittedCount, 1);
assert.equal(workerRows.rows[0].carryOver, true);
await assert.rejects(
  () =>
    managerOperations(
      actor,
      operationsQuery.parse({ locationId: other.id }),
      "overview",
      now,
    ),
  /access/,
);
const adminActor = {
  id: (
    await prisma.manager.create({
      data: {
        name: "Other admin",
        email: randomUUID() + "@test.invalid",
        password: "test-only",
        companyId: foreign.id,
        role: "ADMIN",
      },
    })
  ).id,
  role: "ADMIN" as const,
  companyId: foreign.id,
};
await assert.rejects(
  () =>
    managerOperations(
      adminActor,
      operationsQuery.parse({ locationId: location.id }),
      "tasks",
      now,
    ),
  /access/,
);
const ids: number[] = [];
for (let i = 0; i < 47; i++) {
  const t = await task(
    "Review " + i,
    "2026-10-11T20:00:00Z",
    "2026-10-11T21:00:00Z",
  );
  const c = await prisma.verificationException.create({
    data: {
      companyId: company.id,
      locationId: location.id,
      taskInstanceId: t.id,
      kind: "TASK",
      dedupeKey: "case:" + randomUUID(),
      state: "MANAGER_REVIEW",
      priority: i % 3,
      issues: {
        create: {
          reasonCode: "SERVICE_FAILURE",
          dedupeKey: "failure",
          state: "MANAGER_REVIEW",
          recommendedAction: "Check photo",
        },
      },
    },
  });
  ids.push(c.id);
}
const all = (await listReviews(actor, { page: 1, pageSize: 20 })) as any;
const reviewOverview = (await managerOperations(actor, operationsQuery.parse({ date: "2026-10-12" }), "overview", now)) as any;
assert.equal(reviewOverview.metrics.reviewCount, 47);
assert.equal(reviewOverview.comparison[0].reviews, 47);
const reviewAttention = reviewOverview.attention.filter((a: any) => a.kind === "review");
assert.deepEqual(reviewAttention.map((a: any) => a.caseId), all.cases.slice(0, 3).map((c: any) => c.id));
assert.ok(reviewAttention.every((a: any) => a.reasonCode === "SERVICE_FAILURE" && a.task.verificationException.id === a.caseId));
assert.equal(all.total, 47);
assert.equal(all.cases.length, 20);
assert.ok(
  all.cases.every((c: any) => c.displayReasonCode === "SERVICE_FAILURE"),
);
const second = (await listReviews(actor, { page: 2, pageSize: 20 })) as any;
const third = (await listReviews(actor, { page: 3, pageSize: 20 })) as any;
assert.equal(second.cases.length, 20);
assert.equal(third.cases.length, 7);
assert.equal(
  new Set([...all.cases, ...second.cases, ...third.cases].map((c) => c.id))
    .size,
  47,
);
const found = (await listReviews(actor, { page: 1, q: "Review 46" })) as any;
assert.equal(found.total, 1);
const next = (await listReviews(
  actor,
  { page: 1 },
  all.cases.at(-1).id,
)) as any;
assert.equal(next.nextId, second.cases[0].id);
for (const c of third.cases)
  await prisma.verificationException.update({
    where: { id: c.id },
    data: { state: "RESOLVED" },
  });
const clamped = (await listReviews(actor, { page: 3, pageSize: 20 })) as any;
assert.equal(clamped.page, 2);
assert.equal(clamped.total, 40);
const area = await prisma.area.create({
  data: {
    name: "Room",
    locationId: location.id,
    roomType: "WASHROOM",
    status: "ACTIVE",
  },
});
const fixture = await prisma.areaItem.create({
  data: {
    areaId: area.id,
    stableCode: "SINK-01",
    displayName: "Sink",
    fixtureType: "SINK",
    sequence: 1,
    requiredViews: [
      { key: "BASIN_DRAIN_TAP", instructions: "Show basin", mandatory: true },
    ],
    rubricKey: "visible-v1",
  },
});
const v2 = await task(
  "Missing photo",
  "2026-10-11T20:00:00Z",
  "2026-10-11T21:00:00Z",
  {
    areaId: area.id,
    verificationVersion: 2,
    inventoryVersion: 1,
    areaNameSnapshot: "Room",
    policySnapshot: { version: 1 },
    verificationDeadline: new Date("2026-10-11T22:00:00Z"),
    uploadDeadline: new Date("2026-10-11T23:00:00Z"),
  },
);
const item = await prisma.taskVerificationItem.create({
  data: {
    taskInstanceId: v2.id,
    areaId: area.id,
    sourceAreaItemId: fixture.id,
    itemCodeSnapshot: "SINK-01",
    nameSnapshot: "Sink",
    typeSnapshot: "SINK",
    orderSnapshot: 1,
    identificationSnapshot: {},
    rubricSnapshot: {},
    mandatory: true,
    requirements: {
      create: {
        viewKey: "BASIN_DRAIN_TAP",
        instructionsSnapshot: "Show basin",
      },
    },
  },
});
const c = await prisma.verificationException.create({
  data: {
    companyId: company.id,
    locationId: location.id,
    taskInstanceId: v2.id,
    areaId: area.id,
    kind: "TASK",
    dedupeKey: randomUUID(),
    state: "MANAGER_REVIEW",
    issues: {
      create: {
        reasonCode: "MISSING_EVIDENCE",
        dedupeKey: "missing",
        state: "MANAGER_REVIEW",
        recommendedAction: "Check required views",
      },
    },
  },
});
const issue = await prisma.verificationIssue.findFirstOrThrow({
  where: { exceptionId: c.id },
});
assert.equal(await issueSatisfied(prisma, v2, c.id, issue), false);
await prisma.taskEvidenceRequirement.updateMany({
  where: { taskVerificationItemId: item.id },
  data: { state: "WAIVED" },
});
assert.equal(await issueSatisfied(prisma, v2, c.id, issue), true);

// Exercise the actual router against this isolated DB; importing app.ts would start cron.
process.env.ACCESS_TOKEN_SECRET = "isolated-manager-test-only";
const { default: express } = await import("express");
const { default: jwt } = await import("jsonwebtoken");
const { default: router } =
  await import("../src/routes/verificationException.route.js");
const { default: managerRouter } = await import("../src/routes/manager.route.js");
const { default: locationRouter } = await import("../src/routes/location.route.js");
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.cookies = {};
  next();
});
app.use("/api/manager", managerRouter);
app.use("/api/location", locationRouter);
app.use("/api", router);
app.use((error: any, _req: any, res: any, _next: any) =>
  res.status(error.statusCode ?? 500).json({ message: error.message }),
);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address() as { port: number };
const base = `http://127.0.0.1:${address.port}/api`;
process.env.ACCESS_TOKEN_EXPIRY = '15m';
const { generateAccessToken } = await import('../src/utils/auth.js');
const legacyToken = jwt.sign({id:manager.id,role:'MANAGER'},process.env.ACCESS_TOKEN_SECRET);
assert.equal((await fetch(`${base}/verification-exceptions/count?queue=needs-me`,{headers:{Authorization:`Bearer ${legacyToken}`}})).status,401);
const token = generateAccessToken(manager, 'MANAGER');
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};
const badgeResponse = await fetch(`${base}/verification-exceptions/count?queue=needs-me`, { headers });
assert.equal(badgeResponse.status, 200);
assert.deepEqual(((await badgeResponse.json()) as any).data, await countReviews(actor, {}));
const trendsResponse = await fetch(`${base}/manager/operations/trends?date=2026-10-12&asOf=${now.toISOString()}`, { headers });
assert.equal(trendsResponse.status, 200);
const httpTrends = ((await trendsResponse.json()) as any).data;
assert.equal(httpTrends.rows.length, 1);
await prisma.staff.update({ where: { id: staff.id }, data: { refreshToken: "test-token-must-not-leak" } });
await prisma.taskTemplate.create({ data: {
  title: "Assigned cleaning", locationId: location.id, staffId: staff.id,
  shiftStart: now, shiftEnd: new Date(+now + 3600000), effectiveDate: now,
} });
for (const period of ["current", "previous"] as const) {
  const expected = httpTrends.rows[0][period];
  const statsResponse = await fetch(`${base}/location/${location.id}/stats?dateFrom=${expected.dateFrom}&dateTo=${expected.dateTo}`, { headers });
  assert.equal(statsResponse.status, 200);
  const stats = ((await statsResponse.json()) as any).data;
  let scheduled = 0, submitted = 0;
  for (const row of stats.taskStats) {
    if (row.status !== "CANCELLED") scheduled += row._count.status;
    if (row.status === "COMPLETED") submitted += row._count.status;
  }
  assert.deepEqual({ submitted: expected.submitted, scheduled: expected.scheduled }, { submitted, scheduled });
  assert.equal(stats.locationInfo.staff[0].email, staff.email);
  assert.equal(stats.locationInfo.taskTemplates[0].staff.name, staff.name);
  const assertSafe = (value: any) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!["password", "refreshToken"].includes(key), `sensitive field ${key} must not be returned`);
      assertSafe(child);
    }
  };
  assertSafe(stats);
}
for (const path of [
  `/manager/operations/trends?locationId=${other.id}`,
  `/verification-exceptions/count?locationId=${other.id}`,
]) assert.equal((await fetch(base + path, { headers })).status, 403);
assert.equal((await fetch(`${base}/manager/operations/trends?date=2026-02-30`, { headers })).status, 400);
assert.equal((await fetch(`${base}/verification-exceptions/count?queue=invalid`, { headers })).status, 400);
const workspaceResponse = await fetch(
  `${base}/verification-exceptions/${c.id}`,
  { headers },
);
assert.equal(workspaceResponse.status, 200);
const workspace = ((await workspaceResponse.json()) as any).data;
assert.equal(workspace.items[0].requirements.length, 1);
assert.ok(workspace.issues[0].allowedActions.includes("RESOLVE_ISSUE"));
assert.equal(workspace.items[0].requirements[0].currentAttempt, null);
const requestBody = {
  requestId: randomUUID(),
  expectedVersion: workspace.rowVersion,
  issueId: issue.id,
  action: "RESOLVE_ISSUE",
  reasonCode: "MISSING_EVIDENCE",
  note: "All required views were explicitly waived and checked.",
};
const resolvedResponse = await fetch(
  `${base}/verification-exceptions/${c.id}/actions`,
  { method: "POST", headers, body: JSON.stringify(requestBody) },
);
assert.equal(resolvedResponse.status, 200, await resolvedResponse.text());
assert.equal(
  (
    await prisma.verificationException.findUniqueOrThrow({
      where: { id: c.id },
    })
  ).state,
  "RESOLVED",
);
const replay = await fetch(`${base}/verification-exceptions/${c.id}/actions`, {
  method: "POST",
  headers,
  body: JSON.stringify(requestBody),
});
assert.equal(replay.status, 200);
assert.equal(
  await prisma.verificationDecision.count({ where: { exceptionId: c.id } }),
  1,
);
const deniedToken = generateAccessToken({...adminActor,name:'Synthetic foreign owner',email:'foreign-manager-fixture@example.invalid'},'ADMIN');
assert.equal(
  (
    await fetch(`${base}/verification-exceptions/${c.id}`, {
      headers: { Authorization: `Bearer ${deniedToken}` },
    })
  ).status,
  404,
);
await new Promise<void>((resolve, reject) =>
  server.close((e) => (e ? reject(e) : resolve())),
);
// Compare the consolidated SQL with the operational predicates used by Today.
// Include different local dates, submission/outcome distinctions and excluded rows.
const { taskDayWhere, taskStatusWhere, operationsScope } = await import("../src/services/operationsScope.service.js");
const ny = await prisma.location.create({ data: {
  name: "Different local day", address: "Test", companyId: company.id,
  timezone: "America/New_York", latitude: "0", longitude: "0",
}});
await prisma.managerLocation.create({ data: { managerId: actor.id, locationId: ny.id } });
await task("NY today", "2026-10-11T12:00:00Z", "2026-10-11T13:00:00Z", { locationId: ny.id });
await task("NY tomorrow", "2026-10-12T12:00:00Z", "2026-10-12T13:00:00Z", { locationId: ny.id });
await task("Verified", "2026-10-12T01:00:00Z", "2026-10-12T02:00:00Z", { status: "COMPLETED", completionOutcome: "VERIFIED_COMPLETE" });
await task("Accepted with exceptions", "2026-10-12T01:00:00Z", "2026-10-12T02:00:00Z", { status: "COMPLETED", completionOutcome: "COMPLETED_WITH_EXCEPTIONS" });
await task("Cancelled", "2026-10-12T01:00:00Z", "2026-10-12T02:00:00Z", { status: "CANCELLED" });
await task("Inactive", "2026-10-12T01:00:00Z", "2026-10-12T02:00:00Z", { isActive: false });
const mixed = (await managerOperations(actor, operationsQuery.parse({}), "overview", now)) as any;
const mixedScope = await operationsScope(actor, undefined, "today", now);
const baseWhere = { AND: [
  { isActive: true, status: { not: "CANCELLED" as const }, location: { companyId: actor.companyId } },
  taskDayWhere(mixedScope.days),
] };
for (const [metric, status] of [["totalTasks", "all"], ["submitted", "submitted"], ["inProgress", "in-progress"], ["notStarted", "not-started"], ["overdue", "overdue"]]) {
  const expected = await prisma.taskInstance.count({ where: { AND: [baseWhere, taskStatusWhere(status!, now)] } });
  assert.equal((mixed.metrics[metric!] ?? mixed.chart[metric!]), expected, metric);
}
assert.equal(mixed.metrics.verified, 1);
assert.equal(mixed.metrics.accepted, 1);
assert.equal(mixed.comparison.find((r: any) => r.location.id === ny.id).tasks, 1);
assert.deepEqual(mixed.days.map((d: any) => d.localDate).sort(), ["2026-10-11", "2026-10-12"]);
assert.equal(mixed.tasks.length, 4);

// Two-week trends must match the previous statistics semantics, even with
// different timezones, boundaries, cancellation, inactive tasks and submissions.
await task("Previous week submitted", "2026-10-01T19:00:00Z", "2026-10-01T20:00:00Z", {
  status: "NOT_COMPLETED_INTIME", staffSubmittedAt: new Date("2026-10-01T21:00:00Z"),
});
await task("Before both weeks", "2026-09-20T19:00:00Z", "2026-09-20T20:00:00Z", { status: "COMPLETED" });
const trends = await dashboardTrends(actor, {}, now);
assert.equal(trends.rows.length, 2);
assert.deepEqual(trends.rows.map((r) => r.current.dateTo).sort(), ["2026-10-11", "2026-10-12"]);
for (const row of trends.rows) {
  for (const period of [row.current, row.previous]) {
    const { locationDay } = await import("../src/services/operationsScope.service.js");
    const loc = mixedScope.selected.find((l) => l.id === row.locationId)!;
    const records = await prisma.taskInstance.findMany({ where: {
      locationId: row.locationId, isActive: true,
      date: { gte: locationDay(loc, period.dateFrom).start, lt: locationDay(loc, period.dateTo).end },
    }, select: { status: true, staffSubmittedAt: true } });
    const { operationalTaskStatus } = await import("../src/services/verification-v2/sequentialPolicy.js");
    assert.equal(period.scheduled, records.filter((t) => t.status !== "CANCELLED").length);
    assert.equal(period.submitted, records.filter((t) => operationalTaskStatus(t) === "COMPLETED").length);
  }
}
await assert.rejects(() => dashboardTrends(adminActor, { locationId: location.id }, now), /access/);
assert.deepEqual(await dashboardTrends(adminActor, {}, now), { rows: [] });

// Badge totals remain all-dates and include inactive assigned locations, while
// excluding other queues, unassigned sites and foreign tenants.
const inactiveLocation = await prisma.location.create({ data: {
  name: "Inactive assigned", address: "Test", companyId: company.id,
  timezone: "Asia/Karachi", latitude: "0", longitude: "0", isActive: false,
  managerAssignments: { create: { managerId: manager.id } },
} });
for (const [site, state] of [[inactiveLocation, "OPEN"], [location, "STAFF_ACTION_REQUIRED"], [other, "MANAGER_REVIEW"]] as const)
  await prisma.verificationException.create({ data: {
    companyId: company.id, locationId: site.id, kind: "SETUP", state, dedupeKey: randomUUID(),
    firstRaisedAt: new Date("2026-09-01T00:00:00Z"),
  } });
assert.equal((await countReviews(actor, {})).total, (await listReviews(actor, { page: 1 }) as any).total);
assert.equal((await countReviews(actor, { locationId: inactiveLocation.id })).total, 1);
await assert.rejects(() => countReviews(adminActor, { locationId: location.id }), /access/);
for (let i = 0; i < 5; i++) await prisma.location.create({ data: {
  name: `Extra ${i}`, address: "Test", companyId: company.id, timezone: "UTC", latitude: "0", longitude: "0",
  managerAssignments: { create: { managerId: manager.id } },
} });
const boundedOverview = await managerOperations(actor, operationsQuery.parse({}), "overview", now) as any;
assert.equal(boundedOverview.comparison.length, 4);
assert.equal(boundedOverview.selected.length, 7);
assert.equal(boundedOverview.metrics.totalTasks, mixed.metrics.totalTasks);
const empty = (await managerOperations(adminActor, operationsQuery.parse({}), "overview", now)) as any;
assert.equal(empty.metrics.totalTasks, 0);
assert.deepEqual(empty.tasks, []);
assert.deepEqual(empty.attention, []);
console.log(
  "PASS isolated PostgreSQL: local dates, carry-over, submission, no-staff/unassigned tasks, tenant scope, 47-case pagination/search/next/clamp and resolution satisfaction, real workspace/action routes, audited resolution and idempotency",
);
await prisma.$disconnect();
