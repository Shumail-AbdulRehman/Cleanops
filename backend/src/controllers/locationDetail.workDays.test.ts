import type { Request, Response } from "express";
import { expect, it, vi } from "vitest";
import { getLocationStatsById } from "./location.controller.js";
import { WEEKDAYS } from "../utils/workDays.js";

const db = vi.hoisted(() => ({
  location: { findUnique: vi.fn() },
  taskInstance: { groupBy: vi.fn() },
}));

vi.mock("../prisma/prisma.js", () => ({ prisma: db }));
vi.mock("../services/accountAccess.service.js", () => ({ withAccountCapacity: vi.fn() }));
vi.mock("../services/deletion.service.js", () => ({ permanentlyDelete: vi.fn() }));

it("returns canonical work days for active location staff", async () => {
  const location = { id: 9, companyId: 42, timezone: "Asia/Karachi" };
  db.location.findUnique.mockResolvedValueOnce(location).mockResolvedValueOnce({
    ...location,
    taskInstances: [],
    staff: [
      { id: 7, name: "Selected days", workDays: ["WED", "MON", "WED"] },
      { id: 8, name: "Every day", workDays: [...WEEKDAYS] },
    ],
  });
  db.taskInstance.groupBy.mockResolvedValue([]);
  const req = { params: { id: "9" }, query: {}, user: { companyId: 42, role: "ADMIN" } };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

  await getLocationStatsById(req as unknown as Request, res as unknown as Response);

  expect(db.location.findUnique).toHaveBeenLastCalledWith(expect.objectContaining({
    include: expect.objectContaining({
      staff: { where: { isActive: true }, select: expect.objectContaining({ workDays: true }) },
    }),
  }));
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    statusCode: 200,
    data: {
      locationInfo: {
        ...location,
        taskInstances: [],
        staff: [
          { id: 7, name: "Selected days", workDays: ["MON", "WED"] },
          { id: 8, name: "Every day", workDays: [...WEEKDAYS] },
        ],
      },
      taskStats: [],
    },
  }));
});
