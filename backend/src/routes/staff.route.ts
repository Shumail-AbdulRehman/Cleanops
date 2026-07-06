import { accountAccess } from '../middlewares/accountAccess.middleware.js';
import { getStaffSelfProfile } from "../controllers/staffSelf.controller.js";
import { Router } from "express";
import {
  createStaff,
  getStaff,
  deleteStaff,
  getStaffById,
  getStaffByLocation,
  editStaff,
  getStaffDetails,
} from "../controllers/staff.controller.js";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/authorize.middleware.js";
import { ApiError } from "../utils/ApiError.js";

const router = Router();

router.post("/staff-login", () => {
  throw new ApiError(410, "Update the Hygene Ops app to sign in with your phone number.", [
    { code: "APP_UPDATE_REQUIRED" },
  ]);
});
router.post(
  "/create-staff",
  verifyJwt,
  authorize("ADMIN", "MANAGER"),
  createStaff,
);

router.get("/", verifyJwt, authorize("ADMIN", "MANAGER"), getStaff);
router.get("/profile/me", verifyJwt, authorize("STAFF"), getStaffSelfProfile);
router.get(
  "/details/:id",
  verifyJwt,
  authorize("ADMIN", "MANAGER"),
  getStaffDetails,
);
router.get(
  "/location/:locationId",
  verifyJwt,
  authorize("ADMIN", "MANAGER"),
  getStaffByLocation,
);

router.get("/:id", verifyJwt, authorize("ADMIN", "MANAGER"), getStaffById);
router.delete("/:id", verifyJwt, authorize("ADMIN", "MANAGER"), accountAccess('MANAGE_WORK'), deleteStaff);
router.patch("/:id", verifyJwt, authorize("ADMIN", "MANAGER"), accountAccess('MANAGE_WORK'), editStaff);

export default router;
