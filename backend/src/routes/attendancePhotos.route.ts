import { Router } from "express";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import { getAttendancePhoto } from "../controllers/attendanceMedia.controller.js";

const router = Router();
router.get("/:id/photos/:kind", verifyJwt, getAttendancePhoto);
export default router;
