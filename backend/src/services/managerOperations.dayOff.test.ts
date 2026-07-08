import { beforeEach, describe, expect, it, vi } from "vitest";
import { WEEKDAYS, type Weekday } from "../utils/workDays.js";
import { managerOperations } from "./managerOperations.service.js";
import { operationsQuery } from "./operationsScope.service.js";

const prisma = vi.hoisted(() => ({
  manager: { findFirst: vi.fn() },
  location: { findMany: vi.fn() },
  staff: { count: vi.fn(), findMany: vi.fn() },
  taskInstance: { groupBy: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("../prisma/prisma.js", () => ({ prisma }));

const now = new Date("2026-11-23T20:00:00Z");
const karachi = { id: 11, name: "Karachi", timezone: "Asia/Karachi" };
const lahore = { id: 12, name: "Lahore", timezone: "Asia/Karachi" };
const newYork = { id: 13, name: "New York", timezone: "America/New_York" };
const admin = { id: 8, role: "ADMIN", companyId: 4 } as const;
const manager = { ...admin, role: "MANAGER" } as const;

function staffRow(id: number, location: typeof karachi, workDays?: Weekday[]) {
  return {
    id,
    name: `Staff ${id}`,
    locationId: location.id,
    location,
    workDays,
    attendances: [],
    taskInstances: [],
    _count: { taskInstances: 0 },
  };
}

const offTuesday = staffRow(1, karachi, ["MON", "WED"]);
const everyDay = staffRow(2, karachi, [...WEEKDAYS]);

function offAt(locationIds: number[], weekday: Weekday) {
  return {
    locationId: { in: locationIds },
    workDays: { isEmpty: false },
    NOT: { workDays: { has: weekday } },
  };
}

function expectStaffWhere(criteria: object) {
  expect(prisma.staff.count).toHaveBeenCalledExactlyOnceWith({ where: criteria });
  expect(prisma.staff.findMany).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ where: criteria }),
  );
}

describe("manager operations staff day off", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prisma.$transaction.mockImplementation((read) => read(prisma));
    prisma.manager.findFirst.mockResolvedValue(admin);
    prisma.location.findMany.mockResolvedValue([karachi, lahore, newYork]);
    prisma.taskInstance.groupBy.mockResolvedValue([]);
  });

  it("returns the canonical work days and compares them to each row's local operations day", async () => {
    const rows = [
      { ...offTuesday, workDays: ["WED", "MON", "MON"] },
      everyDay,
      staffRow(3, newYork, ["MON", "WED"]),
      staffRow(4, karachi, []),
      staffRow(5, karachi),
    ];
    prisma.staff.count.mockResolvedValue(rows.length);
    prisma.staff.findMany.mockResolvedValue(rows);

    const result = await managerOperations(admin, operationsQuery.parse({}), "staff", now);

    expect(result).toMatchObject({
      rows: [
        { id: 1, workDays: ["MON", "WED"], offToday: true, localDate: "2026-11-24", attendance: null },
        { id: 2, workDays: WEEKDAYS, offToday: false, attendance: null },
        { id: 3, workDays: ["MON", "WED"], offToday: false, localDate: "2026-11-23" },
        { id: 4, workDays: WEEKDAYS, offToday: false },
        { id: 5, workDays: WEEKDAYS, offToday: false },
      ],
    });
    expect(prisma.staff.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ workDays: true }) }),
    );
  });

  it("filters off in the database by location weekday before counting and paging", async () => {
    prisma.staff.count.mockResolvedValue(1);
    prisma.staff.findMany.mockResolvedValue([offTuesday]);
    const query = operationsQuery.parse({ attendance: "off", page: 2, pageSize: 1 });

    const result = await managerOperations(admin, query, "staff", now);

    expectStaffWhere({
      companyId: admin.companyId,
      isActive: true,
      locationId: { in: [karachi.id, lahore.id, newYork.id] },
      AND: { OR: [offAt([karachi.id, lahore.id], "TUE"), offAt([newYork.id], "MON")] },
    });
    expect(prisma.staff.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 1 }));
    expect(result).toMatchObject({ total: 1, totalPages: 1, page: 1, rows: [{ id: 1, offToday: true }] });
  });

  it("requires a work day and no attendance record for the missing filter on the requested date", async () => {
    prisma.location.findMany.mockResolvedValue([karachi]);
    prisma.staff.count.mockResolvedValue(1);
    prisma.staff.findMany.mockResolvedValue([everyDay]);
    const query = operationsQuery.parse({ attendance: "missing", date: "2026-11-17" });

    const result = await managerOperations(admin, query, "staff", now);

    const start = new Date("2026-11-16T19:00:00Z");
    const end = new Date("2026-11-17T19:00:00Z");
    expectStaffWhere({
      companyId: admin.companyId,
      isActive: true,
      locationId: { in: [karachi.id] },
      attendances: {
        none: {
          OR: [{
            locationId: karachi.id,
            OR: [
              { date: { gte: start, lt: end } },
              { expectedStart: { lt: end }, expectedEnd: { gt: start } },
            ],
          }],
        },
      },
      NOT: { OR: [offAt([karachi.id], "TUE")] },
    });
    expect(result).toMatchObject({ rows: [{ id: 2, offToday: false, attendance: null }] });
  });

  it("limits the off filter to locations assigned to the manager", async () => {
    prisma.location.findMany.mockResolvedValue([karachi]);
    prisma.staff.count.mockResolvedValue(1);
    prisma.staff.findMany.mockResolvedValue([offTuesday]);
    const query = operationsQuery.parse({ attendance: "off" });

    const result = await managerOperations(manager, query, "staff", now);

    expect(prisma.location.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        companyId: manager.companyId,
        isActive: true,
        managerAssignments: { some: { managerId: manager.id } },
      },
    }));
    expectStaffWhere({
      companyId: manager.companyId,
      isActive: true,
      locationId: { in: [karachi.id] },
      AND: { OR: [offAt([karachi.id], "TUE")] },
    });
    expect(result).toMatchObject({ rows: [{ id: 1, locationId: karachi.id, offToday: true }] });
    await expect(managerOperations(manager, { ...query, locationId: lahore.id }, "staff", now))
      .rejects.toThrow("You do not have access to this location");
  });
});
