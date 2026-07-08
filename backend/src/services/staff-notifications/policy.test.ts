import { describe, it, expect, vi, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import { generateAccessToken, generateRefreshToken } from "../../utils/auth.js";
import { WEEKDAYS } from "../../utils/workDays.js";
import {
  notificationCurrent,
  notificationMessage,
  retryDelayMs,
  notificationAlertChannel,
  notificationAlertCategory,
} from "./policy.js";
import { scheduledWindows, reminderKind } from "./reminders.service.js";
import { staffPushSession } from "./session.js";
afterEach(() => vi.unstubAllEnvs());
const now = new Date("2026-10-16T10:00:00Z");
const window = {
  staffId: 2,
  expectedStart: new Date(+now - 600000),
  expectedEnd: new Date(+now + 600000),
  checkInTime: null,
  checkOutTime: null,
};
const notification = {
  kind: "MISSING_CHECK_IN",
  staffId: 2,
  expiresAt: window.expectedEnd,
  data: { windowStart: window.expectedStart.toISOString(), graceMinutes: 10 },
};
describe("staff notification eligibility", () => {
  it("adds readable task context and localized category text to phone alerts", () => {
    const task = notificationMessage("TASK_ASSIGNED", undefined, "en", "  Sink\n  area \u0000 ");
    expect(task.title).toBe("🧹 New task assigned");
    expect(task.body).toBe("Sink area\nOpen Tasks to view your new cleaning task.");
    expect(task.subtitle).toBe("Cleaning tasks");
    expect(notificationMessage("SHIFT_APPROACHING", undefined, "ur").subtitle).toBe("حاضری");
    expect(notificationMessage("TASK_CHANGED", "cancelled", "en", { invalid: true }).body).not.toContain("[object Object]");
  });
  it("uses an event-specific channel only after the app registers support", () => {
    expect(notificationAlertChannel("TASK_ASSIGNED")).toBe("tasks");
    expect(notificationAlertChannel("MISSING_CHECK_IN", 1)).toBe("attendance");
    const ids = ["TASK_ASSIGNED", "TASK_CHANGED", "SHIFT_APPROACHING", "MISSING_CHECK_IN", "CHECKOUT_APPROACHING"].map(kind => notificationAlertChannel(kind, 3));
    expect(new Set(ids).size).toBe(5);
    expect(ids).toContain("staff-missing-check-in-v3");
    expect(notificationAlertCategory("MISSING_CHECK_IN")).toBe("staff_missing_check_in_v3");
    expect(() => notificationAlertChannel("REVIEW_RESOLVED", 3)).toThrow();
  });
  it("does not send reminders after check-in/checkout, rescheduling or expiry", () => {
    expect(notificationCurrent(notification, window, now)).toBe(true);
    expect(
      notificationCurrent(notification, { ...window, checkInTime: now }, now),
    ).toBe(false);
    expect(
      notificationCurrent(notification, { ...window, checkOutTime: now }, now),
    ).toBe(false);
    expect(
      notificationCurrent(notification, { ...window, expectedStart: now }, now),
    ).toBe(false);
    expect(notificationCurrent(notification, window, window.expectedEnd)).toBe(
      false,
    );
  });
  it("invalidates task alerts when work moves, finishes or is cancelled", () => {
    const n = { ...notification, kind: "TASK_ASSIGNED" },
      task = {
        staffId: 2,
        isActive: true,
        status: "PENDING",
        shiftEnd: window.expectedEnd,
      };
    expect(notificationCurrent(n, task, now)).toBe(true);
    for (const change of [
      { staffId: 3 },
      { status: "COMPLETED" },
      { status: "CANCELLED" },
      { staffSubmittedAt: now },
      { isActive: false },
    ])
      expect(notificationCurrent(n, { ...task, ...change }, now)).toBe(false);
    expect(
      notificationCurrent(
        { ...n, kind: "TASK_CHANGED", data: { change: "reassigned" } },
        { ...task, staffId: 3 },
        now,
      ),
    ).toBe(true);
  });
  it("selects only the agreed attendance reminders with a grace period", () => {
    expect(
      reminderKind({ ...window, expectedStart: new Date(+now + 300000) }, now),
    ).toBe("SHIFT_APPROACHING");
    expect(reminderKind(window, now)).toBe("MISSING_CHECK_IN");
    expect(
      reminderKind({ ...window, checkInTime: new Date(+now - 600000) }, now),
    ).toBe("CHECKOUT_APPROACHING");
    expect(
      reminderKind({ ...window, expectedStart: new Date(+now - 60000) }, now),
    ).toBeNull();
    expect(reminderKind({ ...window, checkOutTime: now }, now)).toBeNull();
  });
  it("calculates tomorrow’s midnight shift before its attendance row exists", () => {
    const staff = {
      id: 2,
      companyId: 1,
      locationId: 1,
      location: { timezone: "Asia/Karachi" },
      shiftStart: new Date("1970-01-01T19:00:00Z"),
      shiftEnd: new Date("1970-01-01T03:00:00Z"),
    };
    const before = new Date("2026-10-16T18:55:00Z"),
      windows = scheduledWindows(staff, before);
    expect(windows[1]!.expectedStart.toISOString()).toBe(
      "2026-10-16T19:00:00.000Z",
    );
    expect(reminderKind(windows[1]!, before)).toBe("SHIFT_APPROACHING");
  });
  it("keeps overnight shifts and DST changes in the location timezone", () => {
    const staff = {
      id: 2,
      companyId: 1,
      locationId: 1,
      location: { timezone: "America/New_York" },
      shiftStart: new Date("1970-01-01T03:00:00Z"),
      shiftEnd: new Date("1970-01-01T11:00:00Z"),
    };
    const [w] = scheduledWindows(staff, new Date("2026-10-31T20:00:00Z"));
    expect(w!.expectedStart.toISOString()).toBe("2026-11-01T02:00:00.000Z");
    expect(+w!.expectedEnd - +w!.expectedStart).toBe(9 * 3600000);
  });
  it("provides English and Urdu messages for only the five approved events", () => {
    for (const kind of [
      "TASK_ASSIGNED",
      "TASK_CHANGED",
      "SHIFT_APPROACHING",
      "MISSING_CHECK_IN",
      "CHECKOUT_APPROACHING",
    ])
      expect(notificationMessage(kind, undefined, "ur").title).not.toBe(
        notificationMessage(kind, undefined).title,
      );
    expect(() => notificationMessage("REVIEW_RESOLVED", undefined)).toThrow();
    expect(retryDelayMs(1)).toBe(30000);
    expect(retryDelayMs(30)).toBe(3600000);
  });
});
describe("scheduled shift reminder windows", () => {
  const staff = {
    id: 2,
    companyId: 1,
    locationId: 1,
    location: { timezone: "Asia/Karachi" },
    shiftStart: new Date("1970-01-01T03:00:00Z"),
    shiftEnd: new Date("1970-01-01T11:00:00Z"),
  };
  const tuesday = new Date("2026-11-23T20:00:00Z");
  const tuesdayStart = new Date("2026-11-24T03:00:00Z");
  const wednesdayStart = new Date("2026-11-25T03:00:00Z");

  it("keeps Wednesday's window and skips Tuesday for Monday and Wednesday staff", () => {
    const windows = scheduledWindows(
      { ...staff, workDays: ["MON", "WED"] },
      tuesday,
    );

    expect(windows.map((window) => window.expectedStart)).toEqual([
      wednesdayStart,
    ]);
  });

  it.each([
    { label: "all seven work days", workDays: WEEKDAYS },
    { label: "a missing work-day list", workDays: undefined },
    { label: "an empty work-day list", workDays: [] },
  ])("keeps both windows with $label", ({ workDays }) => {
    const windows = scheduledWindows({ ...staff, workDays }, tuesday);

    expect(windows.map((window) => window.expectedStart)).toEqual([
      tuesdayStart,
      wednesdayStart,
    ]);
  });

  it("uses the local start day of an overnight shift across the DST change", () => {
    const windows = scheduledWindows(
      { ...staff, location: { timezone: "America/New_York" }, workDays: ["SAT"] },
      new Date("2026-10-31T20:00:00Z"),
    );

    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      expectedStart: new Date("2026-11-01T02:00:00Z"),
      expectedEnd: new Date("2026-11-01T11:00:00Z"),
    });
  });
});
describe("staff session duration", () => {
  it("uses a 14-day staff refresh token without changing manager or access expiry", () => {
    vi.stubEnv("REFRESH_TOKEN_SECRET", "test-refresh-only");
    vi.stubEnv("ACCESS_TOKEN_SECRET", "test-access-only");
    vi.stubEnv("REFRESH_TOKEN_EXPIRY", "7d");
    vi.stubEnv("ACCESS_TOKEN_EXPIRY", "30m");
    vi.stubEnv("STAFF_REFRESH_TOKEN_EXPIRY", "");
    const duration = (token: string) => {
      const t = jwt.decode(token) as jwt.JwtPayload;
      return t.exp! - t.iat!;
    };
    const staff = generateRefreshToken({ id: 2 }, "STAFF");
    expect(duration(staff)).toBe(14 * 86400);
    expect(duration(generateRefreshToken({ id: 2 }, "MANAGER"))).toBe(
      7 * 86400,
    );
    expect(
      duration(
        generateAccessToken(
          { id: 2, email: "staff@test.invalid", name: "Test" },
          "STAFF",
        ),
      ),
    ).toBe(1800);
    expect(generateRefreshToken({ id: 2 }, "STAFF")).not.toBe(staff);
    expect(staffPushSession(staff)).not.toBeNull();
    expect(
      staffPushSession(staff, new Date(Date.now() + 31 * 86400000)),
    ).toBeNull();
  });
  it("supports a staff-only configurable duration", () => {
    vi.stubEnv("REFRESH_TOKEN_SECRET", "test-refresh-only");
    vi.stubEnv("STAFF_REFRESH_TOKEN_EXPIRY", "45d");
    const token = jwt.decode(
      generateRefreshToken({ id: 2 }, "STAFF"),
    ) as jwt.JwtPayload;
    expect(token.exp! - token.iat!).toBe(45 * 86400);
  });
});
