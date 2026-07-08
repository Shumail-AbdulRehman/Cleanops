import { describe, expect, it, vi } from "vitest";
import { createTodaysTaskForNewTemplate } from "./inventorySnapshot.service.js";

vi.mock("../../prisma/prisma.js", () => ({ prisma: {} }));
vi.mock("../launchJobs.service.js", () => ({
  jobAccountAllowed: vi.fn().mockResolvedValue(true),
}));

const template = {
  id: 1,
  title: "Clean washroom",
  areaId: 2,
  locationId: 3,
  location: {
    timezone: "Asia/Karachi",
    isActive: true,
    companyId: 4,
    company: { isActive: true },
  },
  isActive: true,
  recurringType: "DAILY",
  effectiveDate: new Date("2026-11-22T19:00:00Z"),
  recurringEndDate: null,
  repeatDays: ["MON"],
  shiftStart: new Date("2026-11-23T04:00:00Z"),
  shiftEnd: new Date("2026-11-23T05:00:00Z"),
  staffId: null,
  verificationVersion: 2,
  setupStatus: "READY",
  inventorySelection: "ALL",
  inventoryItems: [],
};

function mockTransaction() {
  const area = {
    id: template.areaId,
    name: "Washroom",
    inventoryVersion: 1,
    items: [{
      id: 5,
      status: "ACTIVE",
      requiredViews: [{ key: "front", instructions: "Show the sink", mandatory: true }],
    }],
  };

  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    taskTemplate: { findUniqueOrThrow: vi.fn().mockResolvedValue(template) },
    taskInstance: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 6, staffId: null }),
    },
    area: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(area),
      findFirst: vi.fn().mockResolvedValue(area),
    },
  };
}

type SnapshotArguments = Parameters<typeof createTodaysTaskForNewTemplate>;

describe("createTodaysTaskForNewTemplate repeat days", () => {
  it("returns null without starting a snapshot on Tuesday in the location's zone", async () => {
    const tx = mockTransaction();
    const result = await createTodaysTaskForNewTemplate(
      tx as unknown as SnapshotArguments[0],
      template as unknown as SnapshotArguments[1],
      new Date("2026-11-23T21:00:00Z"),
    );

    expect(result).toBeNull();
    expect(tx.taskTemplate.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(tx.taskInstance.create).not.toHaveBeenCalled();
  });

  it("creates today's task and its inventory snapshot on Monday", async () => {
    const tx = mockTransaction();
    const result = await createTodaysTaskForNewTemplate(
      tx as unknown as SnapshotArguments[0],
      template as unknown as SnapshotArguments[1],
      new Date("2026-11-22T21:00:00Z"),
    );

    expect(result).toMatchObject({ id: 6, created: true });
    expect(tx.taskInstance.create).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({
        templateId: template.id,
        date: template.effectiveDate,
        shiftStart: template.shiftStart,
        shiftEnd: template.shiftEnd,
        verificationItems: { create: [expect.objectContaining({ sourceAreaItemId: 5 })] },
      }),
    });
  });
});
