import { writeFile } from "node:fs/promises";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { getZonedDayRange } from "../../backend/src/utils/dateTime.ts";
import { weekdayOfLocalDay } from "../../backend/src/utils/workDays.ts";
// Reuse the real Prisma adapter; dotenv sees only the clean worktree and sanitized child env.
const require = createRequire(
  new URL("../../backend/package.json", import.meta.url),
);
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const hash = require("bcrypt");
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const password = randomBytes(20).toString("base64url"),
  encrypted = await hash.hash(password, 10),
  now = new Date(),
  yesterday = new Date(+now - 86400000);
const siteTimeZone = "Asia/Karachi";
const fixture = {
  password,
  company: {},
  site: {},
  users: {},
  staff: {},
  attendance: {},
  openShiftDate: new Intl.DateTimeFormat("sv-SE", { timeZone: siteTimeZone }).format(now),
  task: {},
};
try {
  for (const key of ["A", "B", "Return0", "Return1", "Return2", "Return3", "workDays", "cleaningSchedules"]) {
    const advanced = key === "workDays" || key === "cleaningSchedules";
    const company = await db.company.create({
      data: { name: `E2E company ${key}`, ...(advanced ? { plan: "ADVANCED" } : {}) },
    });
    fixture.company[key] = company.id;
    const customerId = `ctm_e2e_${key}`,
      subscriptionId = `sub_e2e_${key}`;
    await db.paddleCustomer.create({
      data: {
        id: customerId,
        companyId: company.id,
        status: "active",
        paddleUpdatedAt: now,
        lastEventAt: now,
      },
    });
    await db.paddleSubscription.create({
      data: {
        id: subscriptionId,
        customerId,
        companyId: company.id,
        status: "active",
        priceId: advanced
          ? "pri_00000000000000000000000003"
          : "pri_00000000000000000000000001",
        productId: "pro_e2e",
        currentBillingPeriodStart: new Date(+now - 86400000),
        currentBillingPeriodEnd: new Date(+now + 86400000),
        paddleUpdatedAt: now,
        lastEventAt: now,
      },
    });
    await db.company.update({
      where: { id: company.id },
      data: {
        billingCustomerId: customerId,
        billingSubscriptionId: subscriptionId,
      },
    });
    const owner = await db.manager.create({
      data: {
        name: `E2E owner ${key}`,
        email: `owner-${key.toLowerCase()}@example.invalid`,
        password: encrypted,
        companyId: company.id,
        role: "ADMIN",
        emailVerifiedAt: now,
      },
    });
    fixture.users["owner" + key] = { id: owner.id, email: owner.email };
  }
  for (const key of ["A", "B", "foreign", "workDays"]) {
    const location = await db.location.create({
      data: {
        companyId: key === "foreign" ? fixture.company.B : fixture.company[key === "workDays" ? key : "A"],
        name: key === "workDays" ? "E2E work days site" : `E2E site ${key}`,
        address: "Synthetic test location",
        latitude: "31",
        longitude: "74",
        timezone: siteTimeZone,
      },
    });
    fixture.site[key] = location.id;
  }
  for (const key of ["A", "B"]) {
    const user = await db.manager.create({
      data: {
        companyId: fixture.company.A,
        name: `E2E manager ${key}`,
        email: `manager-${key.toLowerCase()}@example.invalid`,
        password: encrypted,
        role: "MANAGER",
        assignedLocations: { create: { locationId: fixture.site[key] } },
      },
    });
    fixture.users["manager" + key] = { id: user.id, email: user.email };
  }
  const staffSeeds = [
    ["transfer", "A"],
    ["deactivate", "A"],
    ["archive", "A"],
    ["openShift", "A"],
    ["recovery", "A"],
    ["legacy", "A"],
    ["foreign", "foreign"],
  ];
  for (const [index, [key, site]] of staffSeeds.entries()) {
    const companyId = key === "foreign" ? fixture.company.B : fixture.company.A;
    const phone = `+92398000${String(index).padStart(4, "0")}`;
    const row = await db.staff.create({
      data: {
        name: `E2E staff ${key}`,
        email: `staff-${key.toLowerCase()}@example.invalid`,
        phone,
        password: encrypted,
        companyId,
        locationId: fixture.site[site],
      },
    });
    fixture.staff[key] = { id: row.id, email: row.email, phone };
    const signingKey = process.env.REFRESH_TOKEN_SECRET;
    const codeSeed = createHmac("sha256", signingKey).update(`e2e-staff-code:${phone}`).digest();
    const codeHash = createHmac("sha256", signingKey)
      .update(`${phone}:${String(codeSeed.readUInt32BE() % 1_000_000).padStart(6, "0")}`)
      .digest("hex");
    await db.staffLoginCode.create({
      data: { staffId: row.id, companyId, phone, codeHash, expiresAt: new Date(+now + 300_000) },
    });
    const attendance = await db.attendance.create({
      data: {
        staffId: row.id,
        locationId: fixture.site[site],
        date: key === "openShift" ? now : yesterday,
        expectedStart: new Date(
          +(key === "openShift" ? now : yesterday) - 3600000,
        ),
        expectedEnd: new Date(
          +(key === "openShift" ? now : yesterday) + 3600000,
        ),
        checkInTime: key === "openShift" ? new Date(+now - 60000) : yesterday,
        checkOutTime:
          key === "openShift" ? null : new Date(+yesterday + 1800000),
        status: key === "openShift" ? "CHECKED_IN" : "CHECKED_OUT",
        checkInImage:
          key === "legacy"
            ? "https://res.cloudinary.com/fictional/image/upload/v1/attendance-selfies/held.jpg"
            : `attendance:v1:${companyId}:${row.id}:${randomUUID()}`,
      },
    });
    fixture.attendance[key] = attendance.id;
    const task = await db.taskInstance.create({
      data: {
        title: `E2E history ${key}`,
        staffId: row.id,
        locationId: fixture.site[site],
        date: yesterday,
        shiftStart: yesterday,
        shiftEnd: new Date(+yesterday + 3600000),
        startedAt: yesterday,
        completedAt: new Date(+yesterday + 1800000),
        status: "COMPLETED",
      },
    });
    fixture.task[key] = task.id;
  }
  for (const key of ["oldForeign", "newForeign"]) {
    const user = await db.manager.create({
      data: {
        companyId: fixture.company.B,
        name: `E2E manager ${key}`,
        email: `manager-${key.toLowerCase()}@example.invalid`,
        password: encrypted,
        role: "MANAGER",
        ...(key === "oldForeign"
          ? {
              assignedLocations: {
                create: { locationId: fixture.site.foreign },
              },
            }
          : {}),
      },
    });
    fixture.users[key] = { id: user.id, email: user.email };
  }
  const area = await db.area.create({
    data: {
      locationId: fixture.site.A,
      name: "E2E review room",
      roomType: "WASHROOM",
      status: "ACTIVE",
    },
  });
  const item = await db.areaItem.create({
    data: {
      areaId: area.id,
      stableCode: "E2E-SINK",
      displayName: "E2E sink",
      fixtureType: "SINK",
      sequence: 1,
      rubricKey: "sink",
      requiredViews: [{ key: "basin", instructions: "Show the sink basin", mandatory: true }],
    },
  });
  const task = await db.taskInstance.create({
    data: {
      title: "E2E missing-photo review",
      staffId: fixture.staff.recovery.id,
      locationId: fixture.site.A,
      areaId: area.id,
      verificationVersion: 2,
      areaNameSnapshot: area.name,
      inventoryVersion: 1,
      policySnapshot: { version: 1 },
      date: now,
      shiftStart: new Date(+now - 3600000),
      shiftEnd: new Date(+now + 3600000),
      startedAt: new Date(+now - 1800000),
      status: "IN_PROGRESS",
      verificationDeadline: new Date(+now + 3600000),
      uploadDeadline: new Date(+now + 3600000),
    },
  });
  const snapshot = await db.taskVerificationItem.create({
    data: {
      taskInstanceId: task.id,
      areaId: area.id,
      sourceAreaItemId: item.id,
      itemCodeSnapshot: "E2E-SINK",
      nameSnapshot: "E2E sink",
      typeSnapshot: "SINK",
      orderSnapshot: 1,
      identificationSnapshot: {},
      rubricSnapshot: { version: 1 },
    },
  });
  await db.taskEvidenceRequirement.create({
    data: {
      taskVerificationItemId: snapshot.id,
      viewKey: "basin",
      instructionsSnapshot: "Show the sink basin",
      state: "MISSING",
    },
  });
  const review = await db.verificationException.create({
    data: {
      companyId: fixture.company.A,
      locationId: fixture.site.A,
      areaId: area.id,
      taskInstanceId: task.id,
      kind: "TASK",
      dedupeKey: `task:${task.id}`,
    },
  });
  await db.verificationIssue.create({
    data: {
      exceptionId: review.id,
      dedupeKey: "missing-e2e",
      reasonCode: "MISSING_EVIDENCE",
      recommendedAction: "UPLOAD_REQUIRED_PHOTO",
    },
  });
  const photoTask = await db.taskInstance.create({ data: {
    title: 'E2E inspectable required views', locationId: fixture.site.A,
    staffId: fixture.staff.recovery.id, areaId: area.id, verificationVersion: 2,
    areaNameSnapshot: area.name, inventoryVersion: 1, policySnapshot: { version: 1 },
    date: now, shiftStart: new Date(+now - 3600000), shiftEnd: new Date(+now + 3600000),
    verificationDeadline: new Date(+now + 3600000), uploadDeadline: new Date(+now + 3600000),
    status: 'PENDING',
  } });
  const photoItem = await db.taskVerificationItem.create({ data: {
    taskInstanceId: photoTask.id, areaId: area.id, sourceAreaItemId: item.id,
    itemCodeSnapshot: 'E2E-SINK', nameSnapshot: 'E2E sink', typeSnapshot: 'SINK',
    orderSnapshot: 1, identificationSnapshot: {}, rubricSnapshot: { version: 1 },
  } });
  await db.taskEvidenceRequirement.create({ data: {
    taskVerificationItemId: photoItem.id, viewKey: 'basin',
    instructionsSnapshot: 'Show the sink basin', state: 'MISSING',
  } });
  fixture.task.photos = photoTask.id;
  // A real record outside seven days makes period-filter figure changes
  // observable, rather than merely proving that the request URL changed.
  const older = new Date(+now - 15 * 86400000);
  const periodTask = await db.taskInstance.create({ data: {
    title: 'E2E thirty-day-only submission', locationId: fixture.site.B,
    date: older, shiftStart: older, shiftEnd: new Date(+older + 3600000),
    completedAt: new Date(+older + 1800000), status: 'COMPLETED',
  } });
  fixture.task.period = periodTask.id;
  for (const key of ['unpaid', 'legacyOwner', 'deactivatedOwner', 'adoptOwner', 'rejectOwner', 'conflictOwner']) {
    const company = await db.company.create({ data: { name: `S42 ${key}` } });
    fixture.company[key] = company.id;
    const owner = await db.manager.create({ data: {
      name: `S42 ${key}`, email: key === 'legacyOwner' ? 'Legacy.Owner@Example.Invalid' : `${key.toLowerCase()}@example.invalid`,
      password: encrypted, companyId: company.id, role: 'ADMIN', isActive: key !== 'deactivatedOwner',
    } });
    fixture.users[key] = { id: owner.id, email: owner.email };
  }
  // Keep the work-days data outside the original companies and their suite baselines.
  const locationId = fixture.site.workDays;
  const companyId = fixture.company.workDays;
  const tomorrow = new Date(+now + 86400000);
  const dayRange = getZonedDayRange(tomorrow, siteTimeZone);
  let weekStart = dayRange.start;
  while (weekdayOfLocalDay(weekStart, siteTimeZone) !== "MON") {
    weekStart = new Date(+weekStart + 86400000);
  }
  const week = new Intl.DateTimeFormat("sv-SE", { timeZone: siteTimeZone }).format(weekStart);
  const workArea = await db.area.create({
    data: { locationId, name: "E2E work days room", roomType: "WASHROOM", status: "ACTIVE" },
  });
  await db.areaItem.create({
    data: {
      areaId: workArea.id,
      stableCode: "E2E-WORK-DAYS-SINK",
      displayName: "Work days sink",
      fixtureType: "SINK",
      sequence: 1,
      rubricKey: "sink",
      requiredViews: [{ key: "basin", instructions: "Show the sink basin", mandatory: true }],
    },
  });
  fixture.workDays = { today: fixture.openShiftDate, week, area: workArea.name };
  const shiftStart = new Date(`${week}T09:00:00+05:00`);
  const shiftEnd = new Date(`${week}T17:00:00+05:00`);
  const staffWorkDays = {
    everyDay: { name: "Every Day Worker", days: undefined },
    mondayWednesday: { name: "Monday Wednesday Worker", days: ["MON", "WED"] },
    monday: { name: "Monday Worker", days: ["MON"] },
    dayOff: { name: "Day Off Worker", days: [weekdayOfLocalDay(dayRange.start, siteTimeZone)] },
  };
  for (const [index, [key, { name, days }]] of Object.entries(staffWorkDays).entries()) {
    const row = await db.staff.create({
      data: {
        name, phone: `+92398100000${index}`, password: encrypted,
        email: `work-days-${key.toLowerCase()}@example.invalid`,
        companyId, locationId, shiftStart, shiftEnd, ...(days ? { workDays: days } : {}),
      },
    });
    fixture.staff[key] = { id: row.id, email: row.email, phone: row.phone };
  }
  const schedules = [
    { title: "E2E Fixed Tuesday", start: "14:00", end: "15:00", repeatDays: ["TUE"], staffId: fixture.staff.everyDay.id },
    { title: "E2E Daily", start: "12:00", end: "13:00" },
  ];
  for (const { title, start, end, ...assignment } of schedules) {
    await db.taskTemplate.create({
      data: {
        title, locationId, areaId: workArea.id, verificationVersion: 2, setupStatus: "READY",
        recurringType: "DAILY", effectiveDate: new Date(`${week}T00:00:00Z`),
        shiftStart: new Date(`${week}T${start}:00+05:00`),
        shiftEnd: new Date(`${week}T${end}:00+05:00`),
        ...assignment,
      },
    });
  }
  await seedCleaningSchedules(weekStart);
  fixture.reliability = { effectiveDate: week };
  for (const [key, plan, priceId] of [
    ["starter", "STARTER", "pri_00000000000000000000000001"],
    ["enterprise", "ADVANCED", "pri_00000000000000000000000003"],
  ]) {
    const company = await db.company.create({ data: { name: `Reliability ${key}`, plan } });
    const customerId = `ctm_reliability_${key}`;
    const subscriptionId = `sub_reliability_${key}`;
    await db.paddleCustomer.create({ data: {
      id: customerId, companyId: company.id, status: "active", paddleUpdatedAt: now, lastEventAt: now,
    } });
    await db.paddleSubscription.create({ data: {
      id: subscriptionId, customerId, companyId: company.id, status: "active", priceId,
      productId: "reliability_e2e", currentBillingPeriodStart: yesterday,
      currentBillingPeriodEnd: tomorrow, paddleUpdatedAt: now, lastEventAt: now,
    } });
    await db.company.update({ where: { id: company.id }, data: {
      billingCustomerId: customerId, billingSubscriptionId: subscriptionId,
    } });
    const owner = await db.manager.create({ data: {
      name: `Reliability ${key} owner`, email: `reliability-${key}@example.invalid`,
      password: encrypted, companyId: company.id, role: "ADMIN", emailVerifiedAt: now,
    } });
    const ownerKey = `reliability-${key}`;
    fixture.users[ownerKey] = { id: owner.id, email: owner.email };
    const location = await db.location.create({ data: {
      companyId: company.id, name: `Reliability ${key} site`, address: "Synthetic test location",
      latitude: "31", longitude: "74", timezone: siteTimeZone,
    } });
    const room = await db.area.create({ data: {
      locationId: location.id, name: "Reliability washroom", roomType: "WASHROOM", status: "ACTIVE",
    } });
    const sink = await db.areaItem.create({ data: {
      areaId: room.id, stableCode: "E2E-RELIABILITY-SINK", displayName: "Wash basin",
      fixtureType: "SINK", sequence: 1, rubricKey: "sink",
      requiredViews: [{ key: "basin", instructions: "Show the sink basin", mandatory: true }],
    } });
    const worker = await db.staff.create({ data: {
      name: "Daytime Worker", phone: key === "starter" ? "+923982000001" : "+923982000002",
      email: `reliability-staff-${key}@example.invalid`, password: encrypted,
      companyId: company.id, locationId: location.id, shiftStart, shiftEnd,
    } });
    fixture.reliability[key] = { ownerKey, locationId: location.id, areaName: room.name, workerId: worker.id, workerName: worker.name };
    if (key === "starter") {
      const title = "Monday basin cleaning";
      await db.taskTemplate.create({ data: {
        title, locationId: location.id, areaId: room.id, staffId: worker.id,
        verificationVersion: 2, setupStatus: "READY", recurringType: "DAILY", repeatDays: ["MON"],
        effectiveDate: new Date(`${week}T00:00:00Z`),
        shiftStart: new Date(`${week}T10:00:00+05:00`), shiftEnd: new Date(`${week}T11:00:00+05:00`),
      } });
      fixture.reliability.overlapTitle = title;
    } else {
      const manager = await db.manager.create({ data: {
        name: "Reliability reviewer", email: "reliability-reviewer@example.invalid", password: encrypted,
        companyId: company.id, role: "MANAGER", emailVerifiedAt: now,
        assignedLocations: { create: { locationId: location.id } },
      } });
      const reviewerKey = "reliability-reviewer";
      fixture.users[reviewerKey] = { id: manager.id, email: manager.email };
      const bindings = { companyId: company.id, locationId: location.id };
      const endsAt = new Date(+now + 3600000);
      const dirtyTask = await db.taskInstance.create({ data: {
        title: "Basin photo review", locationId: location.id, areaId: room.id, staffId: worker.id,
        verificationVersion: 2, areaNameSnapshot: room.name, inventoryVersion: 1, policySnapshot: { version: 1 },
        date: now, shiftStart: new Date(+now - 3600000), shiftEnd: endsAt, startedAt: new Date(+now - 1800000),
        status: "IN_PROGRESS", verificationDeadline: endsAt, uploadDeadline: endsAt,
      } });
      const taskInstanceId = dirtyTask.id;
      const taskItem = await db.taskVerificationItem.create({ data: {
        taskInstanceId, areaId: room.id, sourceAreaItemId: sink.id, itemCodeSnapshot: sink.stableCode,
        nameSnapshot: sink.displayName, typeSnapshot: sink.fixtureType, orderSnapshot: 1,
        identificationSnapshot: {}, rubricSnapshot: { version: 1 }, state: "CLEANING_REQUIRED",
      } });
      const requirement = await db.taskEvidenceRequirement.create({ data: {
        taskVerificationItemId: taskItem.id, viewKey: "basin", instructionsSnapshot: "Show the sink basin",
        state: "CLEANING_REQUIRED", decisionVersion: 1,
      } });
      const assignment = await db.taskAssignment.create({ data: { taskInstanceId, staffId: worker.id } });
      const session = await db.captureSession.create({ data: {
        taskInstanceId, areaId: room.id, staffId: worker.id, assignmentId: assignment.id,
        assignmentEpoch: 1, deviceId: "fixture-device", qrVersion: 1, policyVersion: 1,
        captureExpiresAt: endsAt, uploadExpiresAt: endsAt, presenceStatus: "VERIFIED",
        locationCheck: {}, serverTimeAnchor: now, clientBootId: "fixture-boot",
      } });
      const slot = await db.captureSlot.create({ data: {
        sessionId: session.id, requirementId: requirement.id, sequence: 1,
        nonceHash: "fixture-unused-nonce-hash", expiresAt: endsAt,
      } });
      const media = await db.evidenceAsset.create({ data: {
        ...bindings, taskInstanceId, originalPublicId: "fixture/reliability/original",
        sanitizedPublicId: "fixture/reliability/review", format: "png", bytes: 1,
        width: 640, height: 480, sha256: "0".repeat(64), privacyState: "NOT_REQUIRED",
      } });
      const attempt = await db.verificationAttempt.create({ data: {
        requirementId: requirement.id, sessionId: session.id, slotId: slot.id, staffId: worker.id,
        assignmentEpoch: 1, mediaAssetId: media.id, clientCaptureId: "fixture-dirty-photo",
        claimedCapturedAt: now, anchoredElapsedMs: 0n, receivedAt: now, timingEvidence: "ANCHORED",
        state: "CLEANING_REQUIRED", cleanlinessResult: { verdict: "DIRTY" },
      } });
      await db.taskEvidenceRequirement.update({ where: { id: requirement.id }, data: { currentAttemptId: attempt.id } });
      const dirtyReview = await db.verificationException.create({ data: {
        ...bindings, areaId: room.id, taskInstanceId, kind: "TASK", dedupeKey: `task:${taskInstanceId}`,
      } });
      await db.verificationIssue.create({ data: {
        exceptionId: dirtyReview.id, requirementId: requirement.id, dedupeKey: "dirty-basin",
        reasonCode: "CLEANING_REQUIRED", recommendedAction: "SCAN_QR_FOR_REWORK",
        firstAttemptId: attempt.id, latestAttemptId: attempt.id,
      } });
      fixture.reliability.dirty = { reviewerKey, reviewId: dirtyReview.id, requirementId: requirement.id, assetId: media.id };
    }
  }
  fixture.review = { id: review.id, taskId: task.id };
  await writeFile(process.env.HYGENE_E2E_MANIFEST, JSON.stringify(fixture), {
    mode: 0o600,
  });
  // Keep every case independent of earlier mutations. This private snapshot
  // contains only this runner's generated accounts, never application data.
  const tables = await db.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
  const tableSnapshot = [];
  for (const { tablename } of tables) {
    const quoted = '"' + tablename.replaceAll('"', '""') + '"';
    const [result] = await db.$queryRawUnsafe(`SELECT coalesce(json_agg(t),'[]'::json) AS rows FROM ${quoted} t`);
    tableSnapshot.push({ table: tablename, rows: result.rows });
  }
  const sequences = await db.$queryRawUnsafe(`SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename`);
  for (const sequence of sequences) {
    const quoted = '"' + sequence.sequencename.replaceAll('"', '""') + '"';
    Object.assign(sequence, (await db.$queryRawUnsafe(`SELECT last_value::text, is_called FROM ${quoted}`))[0]);
  }
  await writeFile(new URL('./seed-snapshot.json', 'file://' + process.env.HYGENE_E2E_MANIFEST), JSON.stringify({ tables: tableSnapshot, sequences }), { mode: 0o600 });
} finally {
  await db.$disconnect();
}

async function seedCleaningSchedules(nextMonday) {
  const companyId = fixture.company.cleaningSchedules;
  const location = await db.location.create({
    data: {
      companyId,
      name: "E2E cleaning schedules site",
      address: "Synthetic test location",
      latitude: "31",
      longitude: "74",
      timezone: siteTimeZone,
    },
  });
  const areas = {};
  for (const [key, name, roomType] of [
    ["washroom", "North washroom", "WASHROOM"],
    ["lobby", "Ground-floor lobby", "OTHER"],
  ]) {
    const area = await db.area.create({
      data: { locationId: location.id, name, roomType, status: "ACTIVE" },
    });
    areas[key] = area.id;
  }
  await db.areaItem.create({
    data: {
      areaId: areas.washroom,
      stableCode: "E2E-CLEANING-SCHEDULES-SINK",
      displayName: "Wash basin",
      fixtureType: "SINK",
      sequence: 1,
      rubricKey: "sink",
      requiredViews: [{ key: "basin", instructions: "Show the sink basin", mandatory: true }],
    },
  });

  const monday = new Date(+nextMonday - 7 * 86400000);
  const week = new Intl.DateTimeFormat("sv-SE", { timeZone: siteTimeZone }).format(monday);
  const at = time => new Date(`${week}T${time}:00+05:00`);
  const weekdays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const workers = [
    { name: "Ayesha Noor", days: weekdays.slice(0, 5), start: "06:00", end: "14:00" },
    { name: "Bilal Ahmed", days: weekdays.slice(0, 6), start: "06:00", end: "14:00" },
    { name: "Sana Javed", days: ["MON", "WED", "FRI"], start: "08:00", end: "16:00" },
    { name: "Hina Saleem", days: weekdays.slice(1), start: "12:00", end: "20:00" },
    { name: "Imran Qureshi", days: weekdays, start: "14:00", end: "22:00" },
    { name: "Usman Tariq", days: weekdays.slice(4), start: "20:00", end: "04:00" },
  ];
  const assignments = {};
  for (const [index, { name, days, start, end }] of workers.entries()) {
    const worker = await db.staff.create({
      data: {
        companyId, locationId: location.id, name,
        email: `schedule-worker-${index}@example.invalid`,
        phone: `+92398300000${index}`,
        password: encrypted,
        workDays: days,
        shiftStart: at(start),
        shiftEnd: at(end),
      },
    });
    assignments[name] = { id: worker.id, days };
  }

  const scheduleSeeds = [
    ["Morning washroom reset", "washroom", "Ayesha Noor", "06:00", "06:45"],
    ["Lobby floor sweep", "lobby", "Bilal Ahmed", "06:15", "07:00"],
    ["Washroom deep clean", "washroom", "Ayesha Noor", "07:00", "08:00"],
    ["Entrance glass polish", "lobby", "Bilal Ahmed", "07:15", "07:45"],
    ["Mirror and counter wipe", "washroom", "Ayesha Noor", "08:05", "08:35"],
    ["Lobby seating wipe", "lobby", "Bilal Ahmed", "08:00", "08:30"],
    ["Basin descaling", "washroom", "Sana Javed", "09:00", "10:00"],
    ["Touchpoint disinfection", "lobby", "Sana Javed", "10:15", "11:00"],
    ["Morning supply check", "washroom", "Ayesha Noor", "11:00", "11:30"],
    ["Midday washroom check", "washroom", "Hina Saleem", "12:00", "12:30"],
    ["Midday lobby tidy", "lobby", null, "12:30", "13:00"],
    ["Washroom bin change", "washroom", "Sana Javed", "13:00", "13:30"],
    ["Lobby door tracks", "lobby", "Imran Qureshi", "14:00", "14:30"],
    ["Afternoon floor mop", "lobby", "Hina Saleem", "14:30", "15:15"],
    ["Washroom restock", "washroom", "Hina Saleem", "16:00", "16:30", ["TUE", "THU", "SAT"], "NEEDS_REVIEW"],
    ["Evening entrance clean", "lobby", "Imran Qureshi", "17:00", "17:45"],
    ["Evening washroom reset", "washroom", "Hina Saleem", "18:00", "18:45"],
    ["Lobby close-down sweep", "lobby", "Imran Qureshi", "19:00", "19:30"],
    ["Evening supply check", "washroom", null, "20:00", "20:30", ["TUE", "THU", "SAT"]],
    ["Entrance mat wash", "lobby", "Imran Qureshi", "21:00", "21:30"],
    ["Late lobby mop", "lobby", "Usman Tariq", "22:00", "23:00"],
    ["Overnight washroom clean", "washroom", "Usman Tariq", "23:30", "00:30"],
  ];
  const records = [];
  for (const [title, area, worker, start, end, days, setupStatus = "READY"] of scheduleSeeds) {
    const assignment = assignments[worker];
    const repeatDays = days ?? assignment?.days ?? weekdays;
    const schedule = await db.taskTemplate.create({
      data: {
        title, locationId: location.id, areaId: areas[area], staffId: assignment?.id,
        verificationVersion: 2, setupStatus, recurringType: "DAILY", repeatDays,
        effectiveDate: new Date(`${week}T00:00:00Z`),
        shiftStart: at(start),
        shiftEnd: at(end),
      },
    });
    records.push({ id: schedule.id, title, worker, repeatDays });
  }
  fixture.cleaningSchedules = { locationId: location.id, week, records };
}
