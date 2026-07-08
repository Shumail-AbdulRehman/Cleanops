import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTodaysTaskForNewTemplate, generateTaskInstances } from "./inventorySnapshot.service.js";

const transaction = vi.hoisted(() => vi.fn());
vi.mock("../../prisma/prisma.js", () => ({ prisma: { $transaction: transaction } }));
vi.mock("../launchJobs.service.js", () => ({ jobAccountAllowed: vi.fn(async () => true) }));

const date = new Date("2026-11-22T19:00:00Z");
const now = new Date("2026-11-22T21:00:00Z");
const template = {
  id: 1,
  title: "Clean washroom",
  areaId: 2,
  locationId: 3,
  location: { timezone: "Asia/Karachi", companyId: 4, isActive: true, company: { isActive: true } },
  isActive: true,
  staffId: 5,
  shiftStart: new Date("2026-11-23T04:00:00Z"),
  shiftEnd: new Date("2026-11-23T05:00:00Z"),
  recurringType: "DAILY",
  repeatDays: ["MON"],
  effectiveDate: date,
  recurringEndDate: null,
  setupStatus: "READY",
  verificationVersion: 2,
  inventorySelection: "ALL",
  inventoryItems: [],
};

const worker = {
  id: template.staffId,
  isActive: true,
  locationId: template.locationId,
  companyId: template.location.companyId,
  shiftStart: template.shiftStart,
  shiftEnd: template.shiftEnd,
};

const area = {
  id: template.areaId,
  name: "Washroom",
  inventoryVersion: 1,
  items: [{
    id: 6,
    status: "ACTIVE",
    requiredViews: [{ key: "front", instructions: "Show the sink", mandatory: true }],
  }],
};

function makeTransaction(staff = worker) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    taskTemplate: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: number } }) => ({ ...template, id: where.id })),
    },
    staff: {
      findUnique: vi.fn(async ({ where }: { where: Partial<typeof worker> }) =>
        Object.entries(where).every(([key, value]) => staff[key as keyof typeof worker] === value) ? staff : null),
    },
    taskInstance: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }: { data: { staffId: number | null } }) => ({ id: 10, staffId: data.staffId })),
    },
    taskAssignment: { create: vi.fn() },
    area: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(area),
      findFirst: vi.fn().mockResolvedValue(area),
    },
  };
}

type SnapshotArguments = Parameters<typeof createTodaysTaskForNewTemplate>;

describe("scheduled task generation with fixed workers", () => {
  beforeEach(() => {
    transaction.mockReset();
  });

  it.each([
    { label: "inactive", isActive: false },
    { label: "at another location", locationId: 30 },
    { label: "in another company", companyId: 40 },
  ])("creates today's task unassigned when the fixed worker is $label", async ({ label, ...override }) => {
    const tx = makeTransaction({ ...worker, ...override });

    const result = await createTodaysTaskForNewTemplate(
      tx as unknown as SnapshotArguments[0], template as unknown as SnapshotArguments[1], now,
    );

    expect(result).toMatchObject({ staffId: null, created: true });
    expect(tx.taskInstance.create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({ staffId: null }) });
    expect(tx.taskAssignment.create).not.toHaveBeenCalled();
  });

  it("creates an assignment for an active fixed worker at the location and company", async () => {
    const tx = makeTransaction();

    const result = await createTodaysTaskForNewTemplate(
      tx as unknown as SnapshotArguments[0], template as unknown as SnapshotArguments[1], now,
    );

    expect(result).toMatchObject({ staffId: worker.id, created: true });
    expect(tx.taskAssignment.create).toHaveBeenCalledExactlyOnceWith({ data: { taskInstanceId: 10, staffId: worker.id } });
  });

  it("logs the failing template and counts the next successful creation", async () => {
    const tx = makeTransaction();
    const error = new Error("Cannot read template");
    tx.taskTemplate.findUniqueOrThrow.mockRejectedValueOnce(error);
    transaction.mockImplementation(work => work(tx));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const row = { title: template.title, locationId: template.locationId, date, shiftStart: template.shiftStart, shiftEnd: template.shiftEnd };

    try {
      expect(await generateTaskInstances([{ ...row, templateId: 1 }, { ...row, templateId: 2 }])).toEqual({ count: 1 });
      expect(tx.taskInstance.create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({ templateId: 2 }) });
      expect(log).toHaveBeenCalledExactlyOnceWith("Task generation failed", { templateId: 1, error });
    } finally {
      log.mockRestore();
    }
  });
});
