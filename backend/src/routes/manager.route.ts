import { Router } from "express";
import {
  signupManager,
  loginManager,
  getManagerProfile,
  getTodayStatus,
  createManager,
  getManagers,
  updateManager,
  deleteManager,
} from "../controllers/manager.controller.js";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/authorize.middleware.js";
import { authRateLimit } from "../services/authRateLimit.js";

import { operationsRead, readDashboardTrends, readCompanyPerformance } from "../controllers/managerOperations.controller.js";
const router = Router();
router.get('/operations/performance',verifyJwt,authorize('ADMIN','MANAGER'),readCompanyPerformance);
router.get("/operations/trends", verifyJwt, authorize("ADMIN", "MANAGER"), readDashboardTrends);
for (const kind of ["overview", "staff", "tasks"] as const)
  router.get(
    `/operations/${kind}`,
    verifyJwt,
    authorize("ADMIN", "MANAGER"),
    operationsRead(kind),
  );

router.post("/manager-signup", authRateLimit.signup, signupManager);
router.post("/manager-login", loginManager);
router.get("/profile/me", verifyJwt, getManagerProfile);
router.get(
  "/today-status",
  verifyJwt,
  authorize("ADMIN", "MANAGER"),
  getTodayStatus,
);
router.post("/", verifyJwt, authorize("ADMIN"), createManager);
router.get("/", verifyJwt, authorize("ADMIN"), getManagers);
router.patch("/:id", verifyJwt, authorize("ADMIN"), updateManager);

router.delete("/:id", verifyJwt, authorize("ADMIN"), deleteManager);

export default router;
