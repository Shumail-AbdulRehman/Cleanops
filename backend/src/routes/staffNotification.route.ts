import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma/prisma.js";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/authorize.middleware.js";
import { ApiError } from "../utils/ApiError.js";
import {
  listStaffNotifications,
  registerStaffDevice,
} from "../services/staff-notifications/inbox.service.js";
const router = Router();
router.use(verifyJwt, authorize("STAFF"));
router.get("/unread-count", async (req, res) => {
  const unreadCount = await prisma.staffNotification.count({
    where: { staffId: req.user!.id, companyId: req.user!.companyId, readAt: null },
  });
  res.json({ success: true, data: { unreadCount } });
});
router.get("/", async (req, res) =>
  res.json({
    success: true,
    data: await listStaffNotifications(req.user!, req.query),
  }),
);
router.post("/devices", async (req, res) =>
  res.json({
    success: true,
    data: await registerStaffDevice(req.user!, req.body),
  }),
);
router.delete("/devices/:id", async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  await prisma.staffPushDevice.updateMany({
    where: { id, staffId: req.user!.id, companyId: req.user!.companyId },
    data: { enabled: false },
  });
  res.json({ success: true, data: { enabled: false } });
});
router.post("/read-all", async (req, res) => {
  await prisma.staffNotification.updateMany({
    where: {
      staffId: req.user!.id,
      companyId: req.user!.companyId,
      readAt: null,
    },
    data: { readAt: new Date() },
  });
  res.json({ success: true, data: { read: true } });
});
router.post("/:id/read", async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const notification = await prisma.staffNotification.findFirst({
    where: { id, staffId: req.user!.id, companyId: req.user!.companyId },
    select: { id: true, kind: true, taskId: true },
  });
  if (!notification) throw new ApiError(404, "Notification not found");
  await prisma.staffNotification.updateMany({
    where: {
      id,
      staffId: req.user!.id,
      companyId: req.user!.companyId,
      readAt: null,
    },
    data: { readAt: new Date() },
  });
  res.json({ success: true, data: { notification } });
});
router.use((error: unknown, _req: any, _res: any, next: any) =>
  next(
    error instanceof z.ZodError
      ? new ApiError(400, "Invalid notification request", error.issues)
      : error,
  ),
);
export default router;
