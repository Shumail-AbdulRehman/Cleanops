import { accountAccess } from '../middlewares/accountAccess.middleware.js';
import { Router } from "express";
import { ApiResponse } from "../utils/ApiResponse.js";
import { verifyJwt, verifyPasswordChangeJwt } from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/authorize.middleware.js";
import { changeOwnPassword, signOutStaffEverywhere } from "../services/credentialHandoff.service.js";
import { getCookieOptions } from "../utils/cookies.js";
const router = Router();
router.use((_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); });
router.post("/security/password", verifyPasswordChangeJwt, async (req, res) => {
  const result = await changeOwnPassword(req.user!, req.body);
  res.clearCookie("accessToken", getCookieOptions()).clearCookie("refreshToken", getCookieOptions()).json(new ApiResponse(200, result, "Password changed. Sign in again."));
});
router.post("/security/staff/:id/sign-out-everywhere", verifyJwt, authorize("ADMIN", "MANAGER"), accountAccess("MANAGE_WORK"), async (req, res) => {
  const result = await signOutStaffEverywhere(req.user!, Number(req.params.id), req.body);
  res.json(new ApiResponse(200, result));
});
export default router;
