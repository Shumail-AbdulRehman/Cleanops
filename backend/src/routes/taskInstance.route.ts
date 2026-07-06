import {
  completeTask,
  getTaskInstanceById,
  getTasknstancesOfLocation,
  getTodaysTasksForStaff,
  retiredEvidenceEndpoint,
  startTask,
  getTaskQr,
  getAreaSubmissions,
} from "../controllers/taskInstance.controller.js";
import { Router } from "express";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/authorize.middleware.js";

const router = Router();
router.get("/staff/:staffId/today", verifyJwt, getTodaysTasksForStaff);
router.post("/:taskId/start", verifyJwt, authorize("STAFF"), startTask);
router.post("/:taskId/area/:referenceImageId/scan", verifyJwt, authorize("STAFF"), retiredEvidenceEndpoint);
router.post('/:taskId/area/:referenceImageId/upload', verifyJwt, authorize('STAFF'), retiredEvidenceEndpoint);
router.post('/:taskId/complete', verifyJwt, authorize('STAFF'), completeTask);
router.get("/:taskId/qr", verifyJwt, authorize("ADMIN", "MANAGER"), getTaskQr);
router.get("/:taskId", verifyJwt, getTaskInstanceById);
router.get("/:taskId/area-submissions", verifyJwt, getAreaSubmissions);
router.get("/location/:locationId", verifyJwt, authorize("ADMIN", "MANAGER"), getTasknstancesOfLocation);


export default router;
