import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { Request, Response } from "express";
const mock = vi.hoisted(() => ({ active: vi.fn(), location: vi.fn(), row: vi.fn(), upload: vi.fn(), privateUrl: vi.fn(), fetch: vi.fn() }));
vi.mock("../prisma/prisma.js", () => ({ prisma: { attendance: { findFirst: mock.row } } }));
vi.mock("./verification-v2/authorization.service.js", () => ({ requireActiveActor: mock.active, requireLocationAccess: mock.location }));
vi.mock("../utils/cloudinary.js", () => ({ default: { utils: { private_download_url: mock.privateUrl } }, uploadBufferToCloudinary: mock.upload }));
import { attendancePhotoPresentation, parseAttendancePhoto, readAttendancePhoto, storeAttendancePhoto } from "./attendanceMedia.service.js";
import { getAttendancePhoto } from "../controllers/attendanceMedia.controller.js";
const reference = "attendance:v1:42:7:12345678-1234-4321-aaaa-123456789abc";
const actor = { id: 7, companyId: 42, role: "STAFF" as const };
const row = () => ({ id: 12, staffId: 7, locationId: 20, checkInImage: reference, checkOutImage: null });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal("fetch", mock.fetch);
  mock.active.mockResolvedValue({}); mock.location.mockResolvedValue({}); mock.row.mockResolvedValue(row());
  mock.privateUrl.mockReturnValue("https://storage.test.invalid/private-signed-do-not-return");
  mock.fetch.mockImplementation(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/jpeg" } }));
  mock.upload.mockImplementation(async (_bytes, options) => ({ public_id: options.public_id, type: "authenticated", secure_url: "must-not-publish" }));
});
afterEach(() => vi.unstubAllGlobals());
describe("attendance private storage and presentation", () => {
  it("uploads decoded metadata-stripped JPEG as authenticated, with opaque reference only", async () => {
    const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: "white" } }).png().toBuffer();
    const result = await storeAttendancePhoto(bytes, 42, 7);
    expect(parseAttendancePhoto(result)).toMatchObject({ companyId: 42, staffId: 7, publicId: expect.stringMatching(/^attendance\/42\/7\//) });
    expect(result).not.toContain("http");
    expect(mock.upload).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({ type: "authenticated", resource_type: "image", format: "jpg", overwrite: false }));
    expect((await sharp(mock.upload.mock.calls[0]![0]).metadata()).format).toBe("jpeg");
  });
  it.each([Buffer.from("<svg/>"), Buffer.alloc(0), Buffer.alloc(5 * 1024 * 1024 + 1)])("rejects malformed/oversized images before storage", async bytes => {
    await expect(storeAttendancePhoto(bytes, 42, 7)).rejects.toMatchObject({ statusCode: 422 });
    expect(mock.upload).not.toHaveBeenCalled();
  });
  it("does not accept provider acknowledgement for public or mismatched storage", async () => {
    mock.upload.mockResolvedValue({ public_id: "different", type: "upload", secure_url: "public" });
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).jpeg().toBuffer();
    await expect(storeAttendancePhoto(bytes, 42, 7)).rejects.toMatchObject({ statusCode: 503 });
  });
  it("suppresses legacy public URLs and raw provider references in DTOs", () => {
    const legacy = "https://res.cloudinary.com/private/image/upload/v1/selfie.jpg";
    const result = attendancePhotoPresentation({ id: 12, checkInImage: legacy, checkOutImage: reference });
    expect(result).toEqual({ id: 12, checkInImage: null, checkOutImage: null,
      checkInPhoto: { state: "LEGACY_RESTRICTED", path: null }, checkOutPhoto: { state: "AVAILABLE", path: "/attendance/12/photos/check-out" } });
    expect(JSON.stringify(result)).not.toContain(legacy); expect(JSON.stringify(result)).not.toContain(reference);
  });
  it.each(["", "https://evil.invalid/image.jpg", "attendance:v1:42:7:../../elsewhere", "attendance:v1:9007199254740992:7:12345678-1234-4321-aaaa-123456789abc"])("rejects untrusted references %j", value => {
    expect(parseAttendancePhoto(value)).toBeNull();
  });
});
describe("attendance byte authorization", () => {
  it("permits own historical attendance without relying on the worker's current site", async () => {
    expect(await readAttendancePhoto({ ...actor, locationId: 99 }, 12, "check-in")).toEqual(Buffer.from([1, 2, 3]));
    expect(mock.row).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 12, staff: { companyId: 42 }, location: { companyId: 42 } } }));
    expect(mock.location).not.toHaveBeenCalled();
    expect(mock.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }));
  });
  it("permits owner company history and checks manager's historical site before storage", async () => {
    await readAttendancePhoto({ ...actor, id: 1, role: "ADMIN" }, 12, "check-in");
    expect(mock.location).not.toHaveBeenCalled();
    await readAttendancePhoto({ ...actor, id: 2, role: "MANAGER" }, 12, "check-in");
    expect(mock.location).toHaveBeenCalledWith({ ...actor, id: 2, role: "MANAGER" }, 20);
    expect(mock.location.mock.invocationCallOrder[0]).toBeLessThan(mock.privateUrl.mock.invocationCallOrder[1]!);
  });
  it("rejects sibling-site manager before generating a provider URL", async () => {
    mock.location.mockRejectedValue({ statusCode: 403 });
    await expect(readAttendancePhoto({ ...actor, id: 1, role: "MANAGER" }, 12, "check-in")).rejects.toMatchObject({ statusCode: 403 });
    expect(mock.privateUrl).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled();
  });
  it("rejects cross-worker reads even with same-company access", async () => {
    await expect(readAttendancePhoto({ ...actor, id: 8 }, 12, "check-in")).rejects.toMatchObject({ statusCode: 404 });
    expect(mock.privateUrl).not.toHaveBeenCalled();
  });
  it("rejects cross-company records and embedded reference mismatch", async () => {
    mock.row.mockResolvedValueOnce(null);
    await expect(readAttendancePhoto({ ...actor, companyId: 99 }, 12, "check-in")).rejects.toMatchObject({ statusCode: 404 });
    mock.row.mockResolvedValue({ ...row(), checkInImage: reference.replace(":42:", ":99:") });
    await expect(readAttendancePhoto(actor, 12, "check-in")).rejects.toMatchObject({ statusCode: 404 });
    expect(mock.fetch).not.toHaveBeenCalled();
  });
  it("does not download absent or legacy public evidence", async () => {
    mock.row.mockResolvedValue({ ...row(), checkInImage: "https://legacy.invalid/photo.jpg" });
    await expect(readAttendancePhoto(actor, 12, "check-in")).rejects.toMatchObject({ statusCode: 404 });
    await expect(readAttendancePhoto(actor, 12, "check-out")).rejects.toMatchObject({ statusCode: 404 });
    expect(mock.fetch).not.toHaveBeenCalled();
  });
  it("rejects deactivated principal before attendance lookup", async () => {
    mock.active.mockRejectedValue({ statusCode: 403 });
    await expect(readAttendancePhoto(actor, 12, "check-in")).rejects.toMatchObject({ statusCode: 403 });
    expect(mock.row).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled();
  });
  it("bounds provider bytes and treats outages/incorrect type as unavailable", async () => {
    mock.fetch.mockResolvedValueOnce(new Response(new Uint8Array(5 * 1024 * 1024 + 1), { headers: { "Content-Type": "image/jpeg" } }));
    await expect(readAttendancePhoto(actor, 12, "check-in")).rejects.toMatchObject({ statusCode: 503 });
    mock.fetch.mockResolvedValueOnce(new Response("not-image", { headers: { "Content-Type": "text/html" } }));
    await expect(readAttendancePhoto(actor, 12, "check-in")).rejects.toMatchObject({ statusCode: 503 });
    mock.fetch.mockRejectedValueOnce(new Error("provider-key-must-not-leak"));
    await expect(readAttendancePhoto(actor, 12, "check-in")).rejects.toMatchObject({ statusCode: 503, message: "Photo storage is temporarily unavailable" });
  });
  it("controller rejects anonymous requests and marks even failures no-store", async () => {
    const res = { setHeader: vi.fn() };
    await expect(getAttendancePhoto({ params: { id: "12", kind: "check-in" } } as unknown as Request, res as unknown as Response)).rejects.toMatchObject({ statusCode: 401 });
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store"); expect(res.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(mock.active).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled();
  });
  it("controller sends authorized JPEG bytes, never redirects to a signed URL", async () => {
    const res = { setHeader: vi.fn(), type: vi.fn(), send: vi.fn() }; res.type.mockReturnValue(res);
    await getAttendancePhoto({ user: actor, params: { id: "12", kind: "check-in" } } as unknown as Request, res as unknown as Response);
    expect(res.type).toHaveBeenCalledWith("image/jpeg"); expect(res.send).toHaveBeenCalledWith(Buffer.from([1, 2, 3]));
  });
});
