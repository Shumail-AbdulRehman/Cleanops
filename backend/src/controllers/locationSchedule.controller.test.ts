import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const db = vi.hoisted(() => ({
  location: vi.fn(), templates: vi.fn(), instances: vi.fn(), create: vi.fn(), update: vi.fn(),
}));
vi.mock("../prisma/prisma.js", () => ({ prisma: {
  location: { findFirst: db.location }, taskTemplate: { findMany: db.templates, create: db.create },
  taskInstance: { findMany: db.instances, update: db.update },
} }));

import { getLocationSchedule } from "./locationSchedule.controller.js";

const request = (role: "ADMIN" | "MANAGER", locationIds: number[] = [2], week = "2026-09-17") => ({
  params: { id: "2" }, query: { week }, user: { role, companyId: 3, locationIds },
}) as unknown as Request;
const response = () => {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { status, json };
};

describe("GET location week schedule read contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.location.mockResolvedValue({ id: 2, name: "Site", timezone: "Asia/Karachi" });
    db.templates.mockResolvedValue([]);
    db.instances.mockResolvedValue([]);
  });

  it("scopes by company and location, normalizes week, and performs no writes", async () => {
    const res = response();
    await getLocationSchedule(request("MANAGER"), res as unknown as Response);
    expect(db.location).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2, companyId: 3, isActive: true } }));
    expect(db.templates).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ repeatDays: true }) }));
    expect(db.instances).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ locationId: 2, isActive: true }) }));
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.weekStart).toBe("2026-09-14");
    expect(payload.data.days).toHaveLength(7);
    expect(db.create).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("rejects a manager with no assigned locations before any database read", async () => {
    await expect(getLocationSchedule(request("MANAGER", []), response() as unknown as Response)).rejects.toMatchObject({ statusCode: 403 });
    expect(db.location).not.toHaveBeenCalled();
  });

  it("rejects invalid and repeated week parameters", async () => {
    await expect(getLocationSchedule(request("ADMIN", [], "2026-02-30"), response() as unknown as Response)).rejects.toMatchObject({ statusCode: 400 });
    const req = request("ADMIN");
    req.query.week = ["2026-09-14", "2026-09-21"];
    await expect(getLocationSchedule(req, response() as unknown as Response)).rejects.toMatchObject({ statusCode: 400 });
  });
});
