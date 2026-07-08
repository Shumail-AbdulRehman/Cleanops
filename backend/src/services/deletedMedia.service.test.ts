import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  jobs: vi.fn(),
  remove: vi.fn(),
  retry: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("../utils/cloudinary.js", () => ({}));
vi.mock("./attendancePhotoReference.js", () => ({
  parseAttendancePhoto: (value: string) => value === "attendance:v1:42:7:12345678-1234-4321-aaaa-123456789abc"
    ? { companyId: 42, staffId: 7, publicId: "attendance/42/7/12345678-1234-4321-aaaa-123456789abc" } : null,
}));
vi.mock("cloudinary", () => ({ v2: { uploader: { destroy: mocks.destroy } } }));
vi.mock("../prisma/prisma.js", () => ({
  prisma: {
    deletedMedia: {
      findMany: mocks.jobs,
      deleteMany: mocks.remove,
      updateMany: mocks.retry,
    },
    taskTemplate: { count: mocks.count },
    taskTemplateReferenceImage: { count: mocks.count },
    taskInstance: { count: mocks.count },
    taskInstanceReferenceImage: { count: mocks.count },
    taskCompletionAttempt: { count: mocks.count },
    taskAreaSubmission: { count: mocks.count },
    attendance: { count: mocks.count },
    evidenceAsset: { count: mocks.count },
  },
}));
import {
  cleanDeletedMedia,
  cloudinaryPublicId,
} from "./deletedMedia.service.js";
const url =
  "https://res.cloudinary.com/cleanops/image/upload/v123/tasks/floor.jpg";
beforeEach(() => {
  vi.resetAllMocks();
  process.env.CLOUDINARY_CLOUD_NAME = "cleanops";
  mocks.count.mockResolvedValue(0);
  mocks.jobs.mockResolvedValue([{ id: 1, url, attempts: 0 }]);
  mocks.destroy.mockResolvedValue({ result: "ok" });
});
describe("permanently deleted media", () => {
  it("accepts only original image URLs belonging to our account", () => {
    expect(cloudinaryPublicId(url)).toBe("tasks/floor");
    expect(cloudinaryPublicId(url.replace("/cleanops/", "/other/"))).toBeNull();
    expect(
      cloudinaryPublicId(url.replace("res.cloudinary.com", "example.com")),
    ).toBeNull();
    expect(cloudinaryPublicId("not-a-url")).toBeNull();
  });
  it("removes unreferenced media and its queued job", async () => {
    await cleanDeletedMedia();
    expect(mocks.destroy).toHaveBeenCalledWith("tasks/floor", {
      invalidate: true,
      resource_type: "image",
    });
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id: 1 } });
  });
  it("keeps photos still referenced by retained task history", async () => {
    mocks.count.mockResolvedValueOnce(1);
    await cleanDeletedMedia();
    expect(mocks.destroy).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalled();
  });
  it("retains an original even when its reservation acknowledgement was lost", async () => {
    mocks.jobs.mockResolvedValue([{id:2,url:"https://res.cloudinary.com/cleanops/image/upload/v123/verification/1/original.jpg",attempts:0}]);
    await cleanDeletedMedia();
    expect(mocks.destroy).not.toHaveBeenCalled();
  });
  it("retains failed cleanup for retry without restoring deleted records", async () => {
    mocks.destroy.mockRejectedValue(new Error("Cloudinary unavailable"));
    await cleanDeletedMedia();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.retry).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({
          attempts: { increment: 1 },
          retryAt: expect.any(Date),
        }),
      }),
    );
  });
  it("treats previously removed remote files as successfully cleaned", async () => {
    mocks.destroy.mockResolvedValue({ result: "not found" });
    await cleanDeletedMedia();
    expect(mocks.remove).toHaveBeenCalled();
    expect(mocks.retry).not.toHaveBeenCalled();
  });
});

describe("private attendance orphan cleanup", () => {
  const reference = "attendance:v1:42:7:12345678-1234-4321-aaaa-123456789abc";
  it("deletes only an unreferenced private orphan using authenticated storage type", async () => {
    mocks.jobs.mockResolvedValue([{ id: 2, url: reference, attempts: 0 }]);
    await cleanDeletedMedia();
    expect(mocks.destroy).toHaveBeenCalledWith("attendance/42/7/12345678-1234-4321-aaaa-123456789abc", { invalidate: true, resource_type: "image", type: "authenticated" });
  });
  it("preserves an authenticated photo still referenced by attendance", async () => {
    mocks.jobs.mockResolvedValue([{ id: 2, url: reference, attempts: 0 }]); mocks.count.mockResolvedValue(1);
    await cleanDeletedMedia(); expect(mocks.destroy).not.toHaveBeenCalled(); expect(mocks.remove).toHaveBeenCalled();
  });
});
