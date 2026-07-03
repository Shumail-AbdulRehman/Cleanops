import { beforeEach, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const db = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("../prisma/prisma.js", () => ({ prisma: { location: { findMany: db.findMany } } }));
import { getLocations } from "./location.controller.js";

const request = (query: Request["query"] = {}, role = "ADMIN", locationIds: number[] = []) =>
  ({ query, user: { id: 1, role, companyId: 42, locationIds } }) as unknown as Request;
const response = () => {
  const json = vi.fn();
  return { json, status: vi.fn().mockReturnValue({ json }) };
};
beforeEach(() => { vi.clearAllMocks(); db.findMany.mockResolvedValue([]); });

it("keeps operational location selectors active-only by default", async () => {
  await getLocations(request(), response() as unknown as Response);
  expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: 42, isActive: true } }));
});

it("lets the directory read retained inactive sites without losing company or assigned-site isolation", async () => {
  const rows = [{ id: 7, isActive: false }];
  db.findMany.mockResolvedValue(rows);
  const res = response();
  await getLocations(request({ includeInactive: "true" }, "MANAGER", [7]), res as unknown as Response);
  expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: 42, id: { in: [7] } } }));
  expect(res.json.mock.calls[0][0].data).toEqual(rows);
});

it("cannot broaden an unassigned manager's scope when including inactive sites", async () => {
  await getLocations(request({ includeInactive: "true" }, "MANAGER"), response() as unknown as Response);
  expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: 42, id: { in: [] } } }));
});

it("rejects malformed or repeated includeInactive filters before database access", async () => {
  for (const value of ["yes", ["true", "false"], { value: "true" }]) {
    await expect(getLocations(request({ includeInactive: value }), response() as unknown as Response)).rejects.toMatchObject({ statusCode: 400 });
  }
  expect(db.findMany).not.toHaveBeenCalled();
});
