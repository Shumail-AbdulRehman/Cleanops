import assert from "node:assert/strict";

// Explicit isolated database only. Never fall back to the application's DATABASE_URL.
const databaseUrl = process.env.DELETION_TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith("_deletion_test"))
  throw new Error(
    "Set DELETION_TEST_DATABASE_URL to an isolated *_deletion_test database",
  );
process.env.DATABASE_URL = databaseUrl;
const { prisma } = await import("../src/prisma/prisma.js");
const { permanentlyDelete } =
  await import("../src/services/deletion.service.js");
let sequence = 0;
const runId = Date.now();
const photo = (n: number) =>
  `https://res.cloudinary.com/test/image/upload/v1/proof-${runId}-${n}.jpg`;
async function fixture() {
  const n = ++sequence;
  const company = await prisma.company.create({
    data: { name: `Delete test ${n}` },
  });
  const location = await prisma.location.create({
    data: {
      companyId: company.id,
      name: "Site",
      address: "Address",
      latitude: "0",
      longitude: "0",
    },
  });
  const staff = await prisma.staff.create({
    data: {
      companyId: company.id,
      locationId: location.id,
      name: "Test staff",
      email: `staff-${Date.now()}-${n}@test.invalid`,
      password: "test-only",
    },
  });
  const manager = await prisma.manager.create({
    data: {
      companyId: company.id,
      name: "Test manager",
      email: `manager-${Date.now()}-${n}@test.invalid`,
      password: "test-only",
      assignedLocations: { create: { locationId: location.id } },
    },
  });
  const template = await prisma.taskTemplate.create({
    data: {
      locationId: location.id,
      staffId: staff.id,
      title: "Schedule",
      shiftStart: new Date(),
      shiftEnd: new Date(),
      effectiveDate: new Date(),
      referenceImageUrl: photo(n),
      referenceImages: { create: { name: "Floor", imageUrl: photo(n) } },
    },
  });
  const task = await prisma.taskInstance.create({
    data: {
      templateId: template.id,
      staffId: staff.id,
      locationId: location.id,
      title: "Historical completed task",
      date: new Date(),
      shiftStart: new Date(),
      shiftEnd: new Date(),
      status: "COMPLETED",
      proofImageUrls: [photo(n)],
      referenceImages: { create: { name: "Floor", imageUrl: photo(n) } },
    },
    include: { referenceImages: true },
  });
  const assignment = await prisma.taskAssignment.create({
    data: { taskInstanceId: task.id, staffId: staff.id, status: "COMPLETED" },
  });
  await prisma.taskCompletionAttempt.create({
    data: {
      taskInstanceId: task.id,
      staffId: staff.id,
      imageUrl: photo(n),
      status: "APPROVED",
    },
  });
  await prisma.taskAreaSubmission.create({
    data: {
      taskInstanceId: task.id,
      referenceImageId: task.referenceImages[0]!.id,
      staffId: staff.id,
      photoUrl: photo(n),
      scannedAt: new Date(),
      attempts: [{ photoUrl: photo(n) }],
    },
  });
  await prisma.attendance.create({
    data: {
      staffId: staff.id,
      locationId: location.id,
      date: new Date(),
      expectedStart: new Date(),
      expectedEnd: new Date(),
      checkInImage: photo(n),
    },
  });
  await prisma.auditLog.create({
    data: {
      companyId: company.id,
      actorType: "SYSTEM",
      entityType: "TASK_ASSIGNMENT",
      entityId: assignment.id,
      action: "CREATED",
    },
  });
  return {
    company,
    location,
    staff,
    manager,
    template,
    task,
    actor: { id: -1, companyId: company.id, role: "ADMIN" as const },
    url: photo(n),
  };
}
try {
  const location = await fixture();
  await permanentlyDelete("location", location.location.id, location.actor);
  assert.equal(
    await prisma.location.count({ where: { id: location.location.id } }),
    0,
  );
  assert.equal(
    await prisma.taskTemplate.count({ where: { id: location.template.id } }),
    0,
  );
  assert.equal(
    await prisma.taskInstance.count({ where: { id: location.task.id } }),
    0,
  );
  for (const model of [
    prisma.taskAssignment,
    prisma.taskCompletionAttempt,
    prisma.taskAreaSubmission,
    prisma.taskInstanceReferenceImage,
  ])
    assert.equal(
      await (model.count as (args: object) => Promise<number>)({
        where: { taskInstanceId: location.task.id },
      }),
      0,
    );
  assert.equal(
    await prisma.attendance.count({ where: { staffId: location.staff.id } }),
    0,
  );
  assert.equal(
    (await prisma.staff.findUniqueOrThrow({ where: { id: location.staff.id } }))
      .locationId,
    null,
  );
  assert.equal(
    await prisma.managerLocation.count({
      where: { managerId: location.manager.id },
    }),
    0,
  );
  assert.equal(
    await prisma.auditLog.count({ where: { companyId: location.company.id } }),
    0,
  );
  assert.equal(
    await prisma.deletedMedia.count({ where: { url: location.url } }),
    1,
  );

  const schedule = await fixture();
  await permanentlyDelete("taskTemplate", schedule.template.id, schedule.actor);
  assert.equal(
    await prisma.taskInstance.count({ where: { id: schedule.task.id, isActive: true } }),
    0,
  );
  assert.equal(
    await prisma.taskTemplateReferenceImage.count({
      where: { templateId: schedule.template.id },
    }),
    1,
  );
  assert.equal(
    await prisma.location.count({ where: { id: schedule.location.id } }),
    1,
  );
  assert.equal(
    await prisma.staff.count({ where: { id: schedule.staff.id } }),
    1,
  );

  const staff = await fixture();
  await permanentlyDelete("staff", staff.staff.id, staff.actor);
  assert.equal(await prisma.staff.count({ where: { id: staff.staff.id } }), 0);
  assert.equal(
    (
      await prisma.taskTemplate.findUniqueOrThrow({
        where: { id: staff.template.id },
      })
    ).staffId,
    null,
  );
  const retainedTask = await prisma.taskInstance.findUniqueOrThrow({
    where: { id: staff.task.id },
  });
  assert.equal(retainedTask.staffId, null);
  assert.deepEqual(retainedTask.proofImageUrls, []);
  assert.equal(
    await prisma.taskAssignment.count({ where: { staffId: staff.staff.id } }),
    0,
  );
  assert.equal(
    await prisma.taskAreaSubmission.count({
      where: { staffId: staff.staff.id },
    }),
    0,
  );
  assert.equal(
    await prisma.taskCompletionAttempt.count({
      where: { staffId: staff.staff.id },
    }),
    0,
  );
  await prisma.staff.create({
    data: {
      companyId: staff.company.id,
      name: "Reused email",
      email: staff.staff.email,
      password: "test-only",
    },
  });

  const manager = await fixture();
  await permanentlyDelete("manager", manager.manager.id, manager.actor);
  assert.equal(
    await prisma.manager.count({ where: { id: manager.manager.id } }),
    0,
  );
  assert.equal(
    await prisma.managerLocation.count({
      where: { managerId: manager.manager.id },
    }),
    0,
  );
  assert.equal(
    await prisma.location.count({ where: { id: manager.location.id } }),
    1,
  );

  const guarded = await fixture();
  await assert.rejects(
    permanentlyDelete("location", guarded.location.id, {
      ...guarded.actor,
      companyId: location.company.id,
    }),
    { statusCode: 404 },
  );
  await assert.rejects(
    permanentlyDelete("location", guarded.location.id, {
      ...guarded.actor,
      role: "MANAGER",
    }),
    { statusCode: 403 },
  );
  await assert.rejects(
    permanentlyDelete("staff", guarded.staff.id, {
      ...guarded.actor,
      role: "MANAGER",
      locationIds: [],
    }),
    { statusCode: 403 },
  );
  await assert.rejects(
    permanentlyDelete("taskTemplate", guarded.template.id, {
      ...guarded.actor,
      role: "STAFF",
    }),
    { statusCode: 403 },
  );
  await assert.rejects(
    permanentlyDelete("manager", guarded.manager.id, {
      ...guarded.actor,
      id: guarded.manager.id,
    }),
    { statusCode: 400 },
  );
  await prisma.manager.update({
    where: { id: guarded.manager.id },
    data: { role: "ADMIN" },
  });
  await assert.rejects(
    permanentlyDelete("manager", guarded.manager.id, guarded.actor),
    { statusCode: 404 },
  );
  await assert.rejects(permanentlyDelete("staff", NaN, guarded.actor), {
    statusCode: 400,
  });

  const rollback = await fixture();
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION reject_test_staff_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER reject_test_staff_delete BEFORE DELETE ON "Staff" FOR EACH ROW EXECUTE FUNCTION reject_test_staff_delete()`,
  );
  await assert.rejects(
    permanentlyDelete("staff", rollback.staff.id, rollback.actor),
  );
  assert.equal(
    await prisma.attendance.count({ where: { staffId: rollback.staff.id } }),
    1,
  );
  assert.equal(
    await prisma.taskAssignment.count({
      where: { staffId: rollback.staff.id },
    }),
    1,
  );
  assert.equal(
    await prisma.deletedMedia.count({ where: { url: rollback.url } }),
    0,
  );
  assert.deepEqual(
    (
      await prisma.taskInstance.findUniqueOrThrow({
        where: { id: rollback.task.id },
      })
    ).proofImageUrls,
    [rollback.url],
  );
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER reject_test_staff_delete ON "Staff"',
  );
  await prisma.$executeRawUnsafe("DROP FUNCTION reject_test_staff_delete()");
  await prisma.staff.update({
    where: { id: rollback.staff.id },
    data: { isActive: false },
  });
  await permanentlyDelete("staff", rollback.staff.id, rollback.actor);
  assert.equal(
    await prisma.staff.count({ where: { id: rollback.staff.id } }),
    0,
  );
  console.log(
    "PASS: permanent deletion, complete cascades, unassignment, email reuse, role/tenant/scope guards, legacy inactive records, media outbox, and transactional rollback",
  );
} finally {
  await prisma.$disconnect();
}
