import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEEKDAYS } from "../utils/workDays.js";
import { getStaffSelfProfile } from "./staffSelf.controller.js";

const findFirst = vi.hoisted(() => vi.fn());
vi.mock("../prisma/prisma.js", () => ({ prisma: { staff: { findFirst } } }));

const actor = { id: 7, companyId: 42, role: "STAFF" };
const existingFields = {
  id: actor.id,
  name: "Ayesha Khan",
  email: null,
  phone: "+923000000000",
  role: actor.role,
  isActive: true,
  companyId: actor.companyId,
  locationId: 3,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-02-01T00:00:00Z"),
  shiftStart: new Date("1970-01-01T04:00:00Z"),
  shiftEnd: new Date("1970-01-01T12:00:00Z"),
};
const staff = {
  ...existingFields,
  workDays: ["MON", "WED"],
  location: { timezone: "Asia/Karachi" },
};

async function fetchProfile(at: string) {
  vi.setSystemTime(new Date(at));
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await getStaffSelfProfile({ user: actor } as Request, response as unknown as Response);
  expect(response.status).toHaveBeenCalledWith(200);
  return response.json.mock.calls[0]![0];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  findFirst.mockReset().mockResolvedValue(staff);
});

afterEach(() => vi.useRealTimers());

describe("getStaffSelfProfile work days", () => {
  it("returns Tuesday off and Wednesday's shift while retaining the original fields in order", async () => {
    findFirst.mockResolvedValue({ ...staff, workDays: ["WED", "MON", "WED"] });
    const result = await fetchProfile("2026-11-24T05:00:00Z");
    expect(result).toEqual({
      statusCode: 200,
      data: {
        ...existingFields,
        workDays: ["MON", "WED"],
        offToday: true,
        nextShiftStart: "2026-11-25T04:00:00.000Z",
      },
      message: "Profile fetched successfully",
      success: true,
    });
    expect(Object.keys(result.data)).toEqual([
      ...Object.keys(existingFields), "workDays", "offToday", "nextShiftStart",
    ]);
    expect(findFirst).toHaveBeenCalledWith({
      where: { ...actor, isActive: true, company: { isActive: true } },
      select: {
        ...Object.fromEntries(Object.keys(existingFields).map((key) => [key, true])),
        workDays: true,
        location: { select: { timezone: true } },
      },
    });
  });

  it("returns Monday's shift when asked at 08:00 on Monday in Karachi", async () => {
    const { data } = await fetchProfile("2026-11-23T03:00:00Z");
    expect(data).toMatchObject({ offToday: false, nextShiftStart: "2026-11-23T04:00:00.000Z" });
  });

  it("uses the assigned location's calendar when the UTC date is different", async () => {
    findFirst.mockResolvedValue({
      ...staff,
      location: { timezone: "Asia/Tokyo" },
      shiftStart: new Date("1970-01-01T00:00:00Z"),
      shiftEnd: new Date("1970-01-01T08:00:00Z"),
    });
    const { data } = await fetchProfile("2026-11-22T23:00:00Z");
    expect(data).toMatchObject({ offToday: false, nextShiftStart: "2026-11-23T00:00:00.000Z" });
  });

  it("uses today's local date during the end of a previous day's overnight shift", async () => {
    findFirst.mockResolvedValue({
      ...staff,
      shiftStart: new Date("1970-01-01T17:00:00Z"),
      shiftEnd: new Date("1970-01-01T01:00:00Z"),
    });
    const { data } = await fetchProfile("2026-11-23T21:00:00Z");
    expect(data).toMatchObject({ offToday: true, nextShiftStart: "2026-11-25T17:00:00.000Z" });
  });

  it.each([
    { location: null, locationId: null },
    { shiftStart: null },
    { shiftEnd: null },
  ])("returns no day-off status or next shift with %j", async (overrides) => {
    findFirst.mockResolvedValue({ ...staff, ...overrides });
    const { data } = await fetchProfile("2026-11-24T05:00:00Z");
    expect(data).toMatchObject({ workDays: ["MON", "WED"], offToday: false, nextShiftStart: null });
  });

  it.each([undefined, []])("defaults %j work days to all seven", async (workDays) => {
    findFirst.mockResolvedValue({ ...staff, workDays });
    const { data } = await fetchProfile("2026-11-24T05:00:00Z");
    expect(data).toMatchObject({
      workDays: WEEKDAYS, offToday: false, nextShiftStart: "2026-11-25T04:00:00.000Z",
    });
  });

  it("uses the mobile profile's Karachi fallback for an invalid location zone", async () => {
    findFirst.mockResolvedValue({ ...staff, location: { timezone: "Invalid/Zone" } });
    const { data } = await fetchProfile("2026-11-23T03:00:00Z");
    expect(data).toMatchObject({ offToday: false, nextShiftStart: "2026-11-23T04:00:00.000Z" });
  });
});
