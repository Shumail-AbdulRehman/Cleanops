import { prisma } from "../../prisma/prisma.js";
import {
  notificationCurrent,
  notificationMessage,
  retryDelayMs,
  notificationAlertChannel,
  notificationAlertCategory,
} from "./policy.js";
import { staffPushSession } from "./session.js";
import {
  collectAttendanceReminders,
  attendanceNotificationSource,
} from "./reminders.service.js";
import {
  ExpoStaffPushProvider,
  type StaffPushProvider,
  type PushMessage,
} from "./push.provider.js";
const MAX_ATTEMPTS = 5;
const transient = (code: string) =>
  ![
    "DeviceNotRegistered",
    "InvalidCredentials",
    "MismatchSenderId",
    "MessageTooBig",
    "EXPO_HTTP_400",
    "EXPO_HTTP_401",
    "EXPO_HTTP_403",
  ].includes(code);
export async function deliverStaffNotifications(
  provider: StaffPushProvider,
  now = new Date(),
) {
  await prisma.staffPushDelivery.updateMany({
    where: {
      status: "SENDING",
      lockedUntil: { lte: now },
      attempts: { gte: MAX_ATTEMPTS },
    },
    data: { status: "FAILED", lockedUntil: null, lastError: "RETRY_LIMIT" },
  });
  await prisma.$executeRaw`
  INSERT INTO "StaffPushDelivery"("notificationId","deviceId","availableAt","createdAt")
  SELECT n.id,d.id,${now},${now} FROM "StaffNotification" n JOIN "StaffPushDevice" d ON d."staffId"=n."staffId" AND d."companyId"=n."companyId"
  WHERE d.enabled AND d."sessionExpiresAt">${now} AND n."expiresAt">${now} AND n."createdAt">=d."boundAt" AND n."readAt" IS NULL
  ON CONFLICT ("notificationId","deviceId") DO NOTHING`;
  const claims = await prisma.$queryRaw<
    Array<{ id: number; attempts: number }>
  >`
  WITH ready AS (SELECT id FROM "StaffPushDelivery" WHERE attempts<${MAX_ATTEMPTS} AND
   ((status='PENDING' AND "availableAt"<=${now}) OR (status='SENDING' AND "lockedUntil"<=${now}))
   ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 50)
  UPDATE "StaffPushDelivery" d SET status='SENDING',attempts=attempts+1,"lockedUntil"=${new Date(+now + 300000)}
  FROM ready WHERE d.id=ready.id RETURNING d.id,d.attempts`;
  const messages: PushMessage[] = [],
    ready: Array<{
      id: number;
      attempts: number;
      deviceId: string;
      token: string;
    }> = [];
  for (const claim of claims) {
    const row = await prisma.staffPushDelivery.findUnique({
      where: { id: claim.id },
      include: {
        notification: true,
        device: {
          include: {
            staff: {
              include: {
                company: { select: { isActive: true, operationalStatus: true } },
                location: { select: { timezone: true, isActive: true } },
              },
            },
          },
        },
      },
    });
    if (!row) continue;
    const { notification: n, device: d } = row,
      staff = d.staff;
    const session = staffPushSession(staff.refreshToken, now);
    let valid =
      d.enabled &&
      d.staffId === n.staffId &&
      d.companyId === n.companyId &&
      staff.companyId === n.companyId &&
      staff.isActive &&
      staff.company.isActive &&
      staff.company.operationalStatus === "ACTIVE" &&
      !!session &&
      session.sessionHash === d.sessionHash &&
      d.sessionExpiresAt > now &&
      !n.readAt;
    if (valid) {
      const source = n.taskId
        ? await prisma.taskInstance.findFirst({
            where: { id: n.taskId, location: { companyId: n.companyId } },
            select: {
              staffId: true,
              status: true,
              isActive: true,
              staffSubmittedAt: true,
              shiftEnd: true,
            },
          })
        : staff.location?.isActive
          ? await attendanceNotificationSource(
              staff,
              n.attendanceId,
              (n.data as { windowStart: string }).windowStart,
            )
          : null;
      valid = !!notificationCurrent(n, source, now);
    }
    if (!valid) {
      await prisma.staffPushDelivery.updateMany({
        where: { id: row.id, attempts: claim.attempts, status: "SENDING" },
        data: {
          status: "CANCELLED",
          lockedUntil: null,
          lastError: "NO_LONGER_APPLICABLE",
        },
      });
      continue;
    }
    messages.push({
      to: d.token,
      ...notificationMessage(
        n.kind,
        (n.data as { change?: string }).change,
        d.language,
        (n.data as { taskTitle?: unknown }).taskTitle,
      ),
      sound: "default",
      priority: "high",
      channelId: notificationAlertChannel(n.kind, d.alertChannelVersion),
      categoryId: notificationAlertCategory(n.kind),
      ttl: Math.max(
        1,
        Math.min(86400, Math.floor((+n.expiresAt - +now) / 1000)),
      ),
      data: {
        notificationId: n.id,
        staffId: n.staffId,
        companyId: n.companyId,
        kind: n.kind,
        taskId: n.taskId,
      },
    });
    ready.push({ ...claim, deviceId: d.id, token: d.token });
  }
  if (!messages.length) return { claimed: claims.length, sent: 0 };
  let results;
  try {
    results = await provider.send(messages);
  } catch (e) {
    const code =
      e instanceof Error && /^EXPO_/.test(e.message)
        ? e.message
        : "EXPO_UNAVAILABLE";
    results = messages.map(() => ({
      status: "error" as const,
      details: { error: code },
    }));
  }
  for (let i = 0; i < ready.length; i++) {
    const item = ready[i]!,
      result = results[i]!,
      code = result.details?.error ?? "EXPO_INVALID_RESPONSE";
    const ok =
      result.status === "ok" && typeof result.id === "string" && !!result.id;
    await prisma.staffPushDelivery.updateMany({
      where: { id: item.id, attempts: item.attempts, status: "SENDING" },
      data: ok
        ? {
            status: "SENT",
            ticketId: result.id!,
            sentToken: item.token,
            lockedUntil: null,
            lastError: null,
            availableAt: new Date(+now + 15 * 60000),
          }
        : {
            status:
              transient(code) && item.attempts < MAX_ATTEMPTS
                ? "PENDING"
                : "FAILED",
            lastError: code,
            lockedUntil: null,
            availableAt: new Date(+now + retryDelayMs(item.attempts)),
          },
    });
    if (code === "DeviceNotRegistered" && !ok)
      await prisma.staffPushDevice.updateMany({
        where: { id: item.deviceId, token: item.token },
        data: { enabled: false },
      });
  }
  return {
    claimed: claims.length,
    sent: results.filter((r) => r.status === "ok" && r.id).length,
  };
}
export async function checkStaffPushReceipts(
  provider: StaffPushProvider,
  now = new Date(),
) {
  const rows = await prisma.staffPushDelivery.findMany({
    where: { status: "SENT", availableAt: { lte: now } },
    orderBy: { id: "asc" },
    take: 100,
    select: {
      id: true,
      attempts: true,
      ticketId: true,
      sentToken: true,
      createdAt: true,
      deviceId: true,
    },
  });
  if (!rows.length) return;
  const receipts = await provider.receipts(
    rows.flatMap((r) => (r.ticketId ? [r.ticketId] : [])),
  );
  for (const row of rows) {
    const result = row.ticketId ? receipts[row.ticketId] : undefined;
    if (!result) {
      await prisma.staffPushDelivery.updateMany({
        where: { id: row.id, status: "SENT" },
        data:
          +now - +row.createdAt > 24 * 3600000
            ? { status: "FAILED", lastError: "RECEIPT_UNCONFIRMED" }
            : { availableAt: new Date(+now + 15 * 60000) },
      });
      continue;
    }
    const code = result.details?.error ?? "EXPO_RECEIPT_ERROR";
    await prisma.staffPushDelivery.updateMany({
      where: { id: row.id, status: "SENT" },
      data:
        result.status === "ok"
          ? { status: "ACCEPTED", lastError: null }
          : {
              status:
                transient(code) &&
                row.attempts < MAX_ATTEMPTS &&
                +now - +row.createdAt < 86400000
                  ? "PENDING"
                  : "FAILED",
              ticketId: null,
              lastError: code,
              availableAt: new Date(+now + retryDelayMs(2)),
            },
    });
    if (
      result.status === "error" &&
      code === "DeviceNotRegistered" &&
      row.sentToken
    )
      await prisma.staffPushDevice.updateMany({
        where: { id: row.deviceId, token: row.sentToken },
        data: { enabled: false },
      });
  }
}
let running = false;
export async function runStaffNotifications(
  now = new Date(),
  provider: StaffPushProvider = new ExpoStaffPushProvider(),
) {
  if (running) return;
  running = true;
  try {
    await collectAttendanceReminders(now);
    if (process.env.STAFF_PUSH_ENABLED === "true") {
      await deliverStaffNotifications(provider, now);
      await checkStaffPushReceipts(provider, now);
    }
  } finally {
    running = false;
  }
}
