vi.mock('./accountAccess.service.js',()=>({assertAccountAction:vi.fn(async()=>({})),assertAccountCompletion:vi.fn(async()=>({})),recordWorkEntitlement:vi.fn(async()=>{})}));
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ staff: vi.fn(), find: vi.fn(), update: vi.fn(), queue: vi.fn(), store: vi.fn(), lock: vi.fn() }));
vi.mock("../prisma/prisma.js", () => ({ prisma: {
  staff: { findFirst: mock.staff }, attendance: { findFirst: mock.find, updateMany: mock.update }, deletedMedia: { createMany: mock.queue },
} }));
import { attendanceDateScope, recordAttendance } from "./attendanceWrites.service.js";
import { checkInSchema, checkOutSchema } from "../validations/attendance.validation.js";
const actor = { id: 7, companyId: 42, role: "STAFF" as const };
const now = new Date("2026-10-20T07:00:00Z");
const location = { id: 20, companyId: 42, isActive: true, latitude: 31.5, longitude: 74.3, radiusMeters: 100, timezone: "Asia/Karachi" };
const input = { latitude: 31.5, longitude: 74.3, accuracy: 20 };
const bytes = Buffer.from("injected-storage-boundary");
const reference = "attendance:v1:42:7:12345678-1234-4321-aaaa-123456789abc";
function row() { return { id: 12, staffId: 7, locationId: 20, date: new Date("2026-10-19T19:00:00Z"), expectedStart: new Date("2026-10-20T03:00:00Z"), expectedEnd: new Date("2026-10-20T11:00:00Z"), status: "CHECKED_IN", checkInTime: new Date("2026-10-20T03:00:00Z"), checkOutTime: null as Date | null, checkInImage: reference, checkOutImage: null as string | null }; }
const db = { $transaction: async (run: (tx: unknown) => unknown) => run({ $queryRaw: mock.lock, attendance: { updateMany: mock.update } }), staff: { findFirst: mock.staff }, attendance: { findFirst: mock.find, updateMany: mock.update }, deletedMedia: { createMany: mock.queue } } as unknown as NonNullable<Parameters<typeof recordAttendance>[5]>;
beforeEach(() => {
  vi.resetAllMocks(); mock.lock.mockResolvedValue([{ id: 7 }]); mock.staff.mockResolvedValue({ id: 7, companyId: 42, role: "STAFF", locationId: 20, location });
  mock.find.mockResolvedValue(row()); mock.update.mockResolvedValue({ count: 1 }); mock.queue.mockResolvedValue({ count: 1 }); mock.store.mockResolvedValue(reference);
});
const save = (kind: "check-in" | "check-out" = "check-out", data = input) => recordAttendance(actor, kind, data, bytes, now, db, mock.store);
describe("strict attendance geography", () => {
  it.each([undefined, null, "", " ", true, [], {}, "north", "NaN", "Infinity", Infinity, -91, 91])("rejects missing or invalid latitude %j", latitude => {
    expect(checkInSchema.safeParse({ ...input, latitude }).success).toBe(false);
  });
  it.each([-181, 181, "", false, null])("rejects invalid longitude %j", longitude => {
    expect(checkOutSchema.safeParse({ ...input, longitude }).success).toBe(false);
  });
  it("preserves legitimate zero coordinates and multipart numeric strings", () => {
    expect(checkInSchema.parse({ latitude: "0", longitude: "0", accuracy: "0" })).toEqual({ latitude: 0, longitude: 0, accuracy: 0 });
    expect(checkOutSchema.parse({ ...input, attendanceId: "12" }).attendanceId).toBe(12);
  });
  it.each([-1, 201, Infinity, "", null])("requires nonnegative bounded finite accuracy %j", accuracy => {
    expect(checkInSchema.safeParse({ ...input, accuracy }).success).toBe(false);
  });
});
describe("attendance atomic writes", () => {
  it("writes checkout conditionally against the exact shift, site, company and active staff", async () => {
    const result = await save();
    expect(mock.update).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      id: 12, staffId: 7, locationId: 20, checkOutTime: null, status: "CHECKED_IN",
      staff: { id: 7, companyId: 42, role: "STAFF", locationId: 20, isActive: true, company: { isActive: true } },
      location: { companyId: 42, isActive: true }, expectedStart: row().expectedStart, expectedEnd: row().expectedEnd,
    }), data: { checkOutTime: now, checkOutImage: reference, status: "CHECKED_OUT" } }));
    expect(mock.lock).toHaveBeenCalledBefore(mock.update);
    expect(result.replayed).toBe(false); expect(mock.queue).not.toHaveBeenCalled();
  });
  it("has one winner and reconciles the saved record under concurrent checkout", async () => {
    const current = row(); let writes = 0;
    mock.find.mockImplementation(async () => ({ ...current }));
    mock.update.mockImplementation(async ({ data }) => {
      if (current.checkOutTime) return { count: 0 };
      writes++; Object.assign(current, data); return { count: 1 };
    });
    const results = await Promise.all([save(), save()]);
    expect(writes).toBe(1); expect(results.map(r => r.replayed).sort()).toEqual([false, true]);
    for (const result of results) expect(result.record.checkOutTime).toEqual(now);
    expect(mock.queue).toHaveBeenCalledTimes(1);
  });
  it("replays explicit attendance ID after lost checkout response without another upload", async () => {
    mock.find.mockResolvedValue({ ...row(), checkOutTime: now, status: "CHECKED_OUT" });
    const result = await recordAttendance(actor, "check-out", { ...input, attendanceId: 12 }, bytes, now, db, mock.store);
    expect(result.replayed).toBe(true); expect(mock.store).not.toHaveBeenCalled(); expect(mock.update).not.toHaveBeenCalled();
    expect(mock.find).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 12, staffId: 7, locationId: 20 }) }));
  });
  it("returns saved check-in on retry without generating another image", async () => {
    const result = await save("check-in"); expect(result.replayed).toBe(true); expect(mock.store).not.toHaveBeenCalled();
  });
  it("preserves late snapshot calculation and conditional absent-only check-in", async () => {
    mock.find.mockResolvedValueOnce({ ...row(), checkInTime: null, status: "ABSENT" });
    await save("check-in");
    expect(mock.update).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ checkInTime: null, checkOutTime: null, status: "ABSENT" }), data: expect.objectContaining({ checkInTime: now, isLateCheckIn: true, lateMinutes: 240, status: "LATE" }) }));
  });
  it("blocks staff transfer/deactivation between upload and write and queues only the proven unused upload", async () => {
    mock.update.mockResolvedValue({ count: 0 }); mock.find.mockResolvedValueOnce(row()).mockResolvedValueOnce(null);
    await expect(save()).rejects.toMatchObject({ statusCode: 409 });
    expect(mock.queue).toHaveBeenCalledWith({ data: [{ url: reference }], skipDuplicates: true });
  });
  it("does not destroy a potentially saved image after an ambiguous database failure", async () => {
    mock.update.mockRejectedValue(new Error("connection lost after commit"));
    await expect(save()).rejects.toThrow("connection lost after commit"); expect(mock.queue).not.toHaveBeenCalled();
  });
  it("rejects wrong role, stale tenant/staff, inactive or cross-tenant site before storage", async () => {
    await expect(recordAttendance({ ...actor, role: "ADMIN" }, "check-in", input, bytes, now, db, mock.store)).rejects.toMatchObject({ statusCode: 403 });
    mock.staff.mockResolvedValueOnce(null);
    await expect(save()).rejects.toMatchObject({ statusCode: 403 });
    mock.staff.mockResolvedValueOnce({ locationId: 20, location: { ...location, companyId: 99 } });
    await expect(save()).rejects.toMatchObject({ statusCode: 403 });
    expect(mock.store).not.toHaveBeenCalled();
  });
  it("rejects checkout before minimum elapsed time or outside geography", async () => {
    mock.find.mockResolvedValueOnce({ ...row(), checkInTime: new Date(+now - 10 * 60_000) });
    await expect(save()).rejects.toMatchObject({ statusCode: 400 });
    await expect(save("check-out", { ...input, latitude: 0 })).rejects.toMatchObject({ statusCode: 400 });
    expect(mock.store).not.toHaveBeenCalled();
  });
  it("finds overnight open shifts using the previous local calendar day across DST", async () => {
    mock.staff.mockResolvedValue({ locationId: 20, location: { ...location, timezone: "America/New_York" } });
    const at = new Date("2026-11-02T08:00:00Z");
    const overnight = { ...row(), date: new Date("2026-11-01T04:00:00Z"), expectedStart: new Date("2026-11-02T03:00:00Z"), expectedEnd: new Date("2026-11-02T09:00:00Z"), checkInTime: new Date("2026-11-02T03:00:00Z") };
    mock.find.mockResolvedValue(overnight);
    await recordAttendance(actor, "check-out", input, bytes, at, db, mock.store);
    expect(mock.find.mock.calls[0]![0].where.date).toEqual({ gte: new Date("2026-11-01T04:00:00Z"), lt: new Date("2026-11-03T05:00:00Z") });
  });
  it("does not convert missed-checkout historical status into an ordinary success status", async () => {
    mock.find.mockResolvedValue({ ...row(), status: "MISSED_CHECKOUT" }); await save();
    expect(mock.update.mock.calls[0]![0].data.status).toBe("MISSED_CHECKOUT");
  });
});
describe("site-bound calendar filters", () => {
  it("binds Karachi and New York day boundaries to their own historical location", () => {
    const result = attendanceDateScope([{ id: 20, timezone: "Asia/Karachi" }, { id: 30, timezone: "America/New_York" }], "2026-11-01", "2026-11-01");
    expect(result.OR).toEqual([
      { locationId: 20, date: { gte: new Date("2026-10-31T19:00:00Z"), lt: new Date("2026-11-01T19:00:00Z") } },
      { locationId: 30, date: { gte: new Date("2026-11-01T04:00:00Z"), lt: new Date("2026-11-02T05:00:00Z") } },
    ]);
  });
  it("empty scope stays empty and malformed/reversed dates do not silently broaden it", () => {
    expect(attendanceDateScope([], "2026-10-20", "2026-10-20")).toEqual({ OR: [] });
    for (const [from, to] of [["2026-02-30", "2026-03-01"], ["2026-10-21", "2026-10-20"], ["wrong", undefined]])
      expect(() => attendanceDateScope([], from, to)).toThrow();
  });
});
