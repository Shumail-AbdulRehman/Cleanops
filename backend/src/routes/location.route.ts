import staffImportRouter from "./staffImport.route.js";
import { accountAccess } from '../middlewares/accountAccess.middleware.js';
import taskReadinessRouter from "./taskReadiness.route.js";
import { Router } from "express";
import {
  createLocation,
  editLocation,
  getLocations,
  deleteLocation,
  getLocationById,
  getLocationStatsById,
} from "../controllers/location.controller.js";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/authorize.middleware.js";
import { getLocationSchedule } from "../controllers/locationSchedule.controller.js";
import { getLocationMapConfig } from "../controllers/mapConfig.controller.js";

const router = Router();
router.use(taskReadinessRouter);
router.use(staffImportRouter);
router.get("/map-config", verifyJwt, authorize("ADMIN", "MANAGER"), getLocationMapConfig);

router.post("/", verifyJwt, authorize("ADMIN"), createLocation);
router.get("/", verifyJwt, authorize("ADMIN", "MANAGER"), getLocations);
router.get("/:id/schedule", verifyJwt, authorize("ADMIN", "MANAGER"), getLocationSchedule);
router.patch("/:id", verifyJwt, authorize("ADMIN"), accountAccess('MANAGE_WORK'), editLocation);
router.delete("/:id", verifyJwt, authorize("ADMIN"), accountAccess('MANAGE_WORK'), deleteLocation);
router.get("/:id", verifyJwt, authorize("ADMIN", "MANAGER"), getLocationById);
router.get(
  "/:id/stats",
  verifyJwt,
  authorize("ADMIN", "MANAGER"),
  getLocationStatsById,
);

export default router;
