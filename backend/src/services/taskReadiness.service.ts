import {readAccountState,evaluateAccountAccess} from './accountAccess.service.js';
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { getZonedDayRange } from "../utils/dateTime.js";
import { requireActiveActor, requireOperationalRole, type VerificationActor } from "./verification-v2/authorization.service.js";

export const readinessQuery = z.object({
  locationId: z.coerce.number().int().positive().optional(),
  afterId: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

/** Derived setup is a read, never a scheduler invocation or persisted checklist. */
export async function workspaceTaskReadiness(actor: VerificationActor, raw: unknown, now = new Date()) {
  requireOperationalRole(actor); await requireActiveActor(actor);
  const query = readinessQuery.safeParse(raw);
  if (!query.success) throw new ApiError(400, "Choose a valid readiness page or site");
  const { locationId, afterId, limit } = query.data;
  const state=await readAccountState(actor.companyId);
  let manageWork=true;
  try {evaluateAccountAccess(state,actor.role,'MANAGE_WORK',now);}
  catch(error) {if(error instanceof ApiError && error.statusCode===403)manageWork=false;else throw error;}
  const access={manageWork};
  const scope: Prisma.LocationWhereInput = {
    companyId: actor.companyId, isActive: true,
    ...(actor.role === "MANAGER" ? { managerAssignments: { some: { managerId: actor.id } } } : {}),
    ...(locationId ? { id: locationId } : {}),
  };
  const [locations, totalLocations] = await Promise.all([
    prisma.location.findMany({
      where: { AND: [scope, { id: { gt: afterId } }] },
      select: { id: true, name: true, timezone: true }, orderBy: { id: "asc" }, take: limit + 1,
    }),
    prisma.location.count({ where: scope }),
  ]);
  if (locationId && !totalLocations) throw new ApiError(404, "Site not found in your workspace");
  const page = locations.slice(0, limit);
  if (!page.length) return { asOf: now, access, totalLocations, sites: [], nextCursor: null, calendar: "DAILY_INCLUDES_EVERY_DAY" as const };
  const ids = page.map(location => location.id);
  const activeLocation: Prisma.LocationWhereInput = { ...scope, id: { in: ids } };
  const siteWhere = { locationId: { in: ids }, location: activeLocation };
  const dayPredicates = page.map(location => {
    const { start, end } = getZonedDayRange(now, location.timezone);
    return { locationId: location.id, OR: [{ date: { gte: start, lt: end } }, { shiftStart: { lt: end }, shiftEnd: { gt: start } }] };
  });
  const taskWhere: Prisma.TaskInstanceWhereInput = { ...siteWhere, isActive: true, OR: dayPredicates };
  const [staff, areas, schedules, tasks, unassigned] = await Promise.all([
    prisma.staff.groupBy({ by: ["locationId"], where: { ...siteWhere, companyId: actor.companyId, role: "STAFF", isActive: true, shiftStart: { not: null }, shiftEnd: { not: null } }, _count: { _all: true } }),
    prisma.area.groupBy({ by: ["locationId"], where: { ...siteWhere, status: "ACTIVE" }, _count: { _all: true } }),
    prisma.taskTemplate.groupBy({ by: ["locationId"], where: {
      ...siteWhere, isActive: true, verificationVersion: 2, setupStatus: "READY", recurringType: { in: ["DAILY", "ONCE"] },
      area: { status: "ACTIVE" },
      // Bind the default worker to this exact site, not just any worker in company.
      OR: ids.map(id => ({ locationId: id, staff: { companyId: actor.companyId, locationId: id, isActive: true, role: "STAFF", shiftStart: { not: null }, shiftEnd: { not: null } } })),
    }, _count: { _all: true } }),
    prisma.taskInstance.groupBy({ by: ["locationId"], where: taskWhere, _count: { _all: true } }),
    prisma.taskInstance.groupBy({ by: ["locationId"], where: { ...taskWhere, staffId: null, staffSubmittedAt: null, status: { not: "COMPLETED" } }, _count: { _all: true } }),
  ]);
  const count = (rows: { locationId: number | null; _count: { _all: number } }[], id: number) => rows.find(row => row.locationId === id)?._count._all ?? 0;
  const sites = page.map(location => {
    const counts = { staffWithShift: count(staff, location.id), activeAreas: count(areas, location.id), readySchedules: count(schedules, location.id), tasksToday: count(tasks, location.id), unassignedTasksToday: count(unassigned, location.id) };
    const reasons: string[] = [];
    if (!counts.staffWithShift) reasons.push("STAFF_SHIFT_REQUIRED");
    if (!counts.activeAreas) reasons.push("AREA_SETUP_REQUIRED");
    if (!counts.readySchedules) reasons.push("SCHEDULE_SETUP_REQUIRED");
    if (counts.unassignedTasksToday) reasons.push(counts.staffWithShift ? "UNASSIGNED_WORK" : "NO_ELIGIBLE_STAFF");
    return { ...location, counts, setupReady: counts.staffWithShift > 0 && counts.activeAreas > 0 && counts.readySchedules > 0, reasons };
  });
  return { asOf: now, access, totalLocations, sites, nextCursor: locations.length > limit ? page.at(-1)!.id : null, calendar: "DAILY_INCLUDES_EVERY_DAY" as const };
}
