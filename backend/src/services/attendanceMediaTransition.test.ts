import { beforeEach, describe, expect, it, vi } from "vitest";
import { inventoryAttendanceMedia, legacyAttendanceSource, transitionAttendanceEntry, assertIsolatedMediaDatabase, transitionManifestSchema, referenceDigest, type TransitionRow } from "./attendanceMediaTransition.service.js";
const oldUrl = "https://res.cloudinary.com/cleanops/image/upload/v123/attendance-selfies/abcdef.jpg";
const row = (): TransitionRow => ({ id: 12, companyId: 42, staffId: 7, locationId: 20, locationCompanyId: 42, checkInImage: oldUrl, checkOutImage: null });
const entry = () => inventoryAttendanceMedia([row()], "cleanops").entries[0]!;
const read = vi.fn(), copyAndVerify = vi.fn(), compareAndSwap = vi.fn();
const boundary = { read, copyAndVerify, compareAndSwap };
beforeEach(() => { vi.resetAllMocks(); read.mockResolvedValue(row()); copyAndVerify.mockResolvedValue({ sourceSha256: "a".repeat(64), destinationSha256: "a".repeat(64) }); compareAndSwap.mockResolvedValue(true); });
describe("redacted attendance asset inventory", () => {
  it("binds each source digest/destination to company, worker, attendance and site without exposing URLs", () => {
    const manifest = inventoryAttendanceMedia([row()], "cleanops");
    expect(manifest.entries[0]).toMatchObject({ attendanceId: 12, companyId: 42, staffId: 7, locationId: 20, field: "checkInImage", state: "READY", sourceDigest: referenceDigest(oldUrl), destination: expect.stringMatching(/^attendance:v1:42:7:/) });
    expect(JSON.stringify(manifest)).not.toContain(oldUrl); expect(JSON.stringify(manifest)).not.toContain("https:");
  });
  it.each([
    oldUrl.replace("cleanops", "other-account"), oldUrl.replace("res.cloudinary.com", "evil.invalid"),
    oldUrl.replace("/v123/", "/w_100/v123/"), oldUrl + "?token=secret", oldUrl.replace("attendance-selfies", "verification"),
    oldUrl.replace("abcdef.jpg", "..%2fprivate.jpg"), oldUrl.replace("https:", "http:"), "attendance:v1:99:7:12345678-1234-4321-aaaa-123456789abc",
  ])("holds ambiguous/foreign/non-original source instead of guessing %j", source => {
    expect(inventoryAttendanceMedia([{ ...row(), checkInImage: source }], "cleanops").entries[0]!.state).toBe("HELD");
    expect(legacyAttendanceSource(source, "cleanops")).toBeNull();
  });
  it("holds broken tenant binding and skips already-private or absent images", () => {
    const privateRef = "attendance:v1:42:7:12345678-1234-4321-aaaa-123456789abc";
    expect(inventoryAttendanceMedia([{ ...row(), locationCompanyId: 99 }], "cleanops").entries[0]!.state).toBe("HELD");
    expect(inventoryAttendanceMedia([{ ...row(), checkInImage: privateRef }], "cleanops").entries[0]!.state).toBe("PRIVATE");
    expect(inventoryAttendanceMedia([{ ...row(), checkInImage: null }], "cleanops").entries).toEqual([]);
  });
  it("rejects tampered destination or arbitrary SQL field in a supplied manifest", () => {
    const manifest = inventoryAttendanceMedia([row()], "cleanops");
    expect(() => transitionManifestSchema.parse({ ...manifest, entries: [{ ...entry(), destination: "attendance:v1:99:7:12345678-1234-4321-aaaa-123456789abc" }] })).toThrow();
    expect(() => transitionManifestSchema.parse({ ...manifest, entries: [{ ...entry(), field: 'password"; DROP TABLE' }] })).toThrow();
  });
});
describe("isolated-only apply guard", () => {
  it.each([undefined, "postgresql://user:password@remote.invalid/app_test", "postgresql://user:password@127.0.0.1/production", "https://127.0.0.1/app_test", "postgresql://user:password@127.0.0.1/production?dbname=app_test"])("rejects unknown/remote/production DB without echoing credentials %j", url => {
    expect(() => assertIsolatedMediaDatabase(url)).toThrow();
    try { assertIsolatedMediaDatabase(url); } catch (error) { expect((error as Error).message).not.toContain("password"); }
  });
  it("accepts explicit loopback test database and rejects production process mode", () => {
    expect(() => assertIsolatedMediaDatabase("postgresql://user:password@127.0.0.1/hygene_test")).not.toThrow();
    expect(() => assertIsolatedMediaDatabase("postgresql://user:password@127.0.0.1/hygene_test", "production")).toThrow();
  });
});
describe("copy verification and compare-and-swap", () => {
  it("changes only the confirmed original reference after verified copy", async () => {
    const e = entry(); expect(await transitionAttendanceEntry(e, "cleanops", boundary)).toEqual({ attendanceId: 12, field: "checkInImage", state: "MIGRATED" });
    expect(copyAndVerify).toHaveBeenCalledWith({ publicId: "attendance-selfies/abcdef", format: "jpg", version: 123 }, e.destination);
    expect(compareAndSwap).toHaveBeenCalledWith(e, oldUrl);
    expect(copyAndVerify.mock.invocationCallOrder[0]).toBeLessThan(compareAndSwap.mock.invocationCallOrder[0]!);
  });
  it("is replay-safe after a completed migration without copying again", async () => {
    const e = entry(); read.mockResolvedValue({ ...row(), checkInImage: e.destination });
    expect((await transitionAttendanceEntry(e, "cleanops", boundary)).state).toBe("ALREADY_PRIVATE"); expect(copyAndVerify).not.toHaveBeenCalled(); expect(compareAndSwap).not.toHaveBeenCalled();
  });
  it.each([null, { ...row(), checkInImage: oldUrl.replace("abcdef", "newasset") }, { ...row(), companyId: 99 }, { ...row(), locationId: 30 }, { ...row(), staffId: 8 }])("does not overwrite changed attendance binding/source", async changed => {
    read.mockResolvedValue(changed); expect((await transitionAttendanceEntry(entry(), "cleanops", boundary)).state).toBe("CONFLICT"); expect(copyAndVerify).not.toHaveBeenCalled(); expect(compareAndSwap).not.toHaveBeenCalled();
  });
  it("holds hash mismatch and preserves database reference", async () => {
    copyAndVerify.mockResolvedValue({ sourceSha256: "a".repeat(64), destinationSha256: "b".repeat(64) });
    expect((await transitionAttendanceEntry(entry(), "cleanops", boundary)).state).toBe("HELD"); expect(compareAndSwap).not.toHaveBeenCalled();
  });
  it("never silently overwrites a concurrent field change after copying", async () => {
    compareAndSwap.mockResolvedValue(false); expect((await transitionAttendanceEntry(entry(), "cleanops", boundary)).state).toBe("CONFLICT");
  });
  it("redacts storage errors and leaves retry idempotent", async () => {
    copyAndVerify.mockRejectedValue(new Error("https://private.invalid?api_key=secret"));
    const result = await transitionAttendanceEntry(entry(), "cleanops", boundary); expect(result.state).toBe("UNAVAILABLE"); expect(JSON.stringify(result)).not.toContain("secret"); expect(compareAndSwap).not.toHaveBeenCalled();
  });
});
