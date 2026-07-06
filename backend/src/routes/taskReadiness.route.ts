import { Router } from "express";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/authorize.middleware.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { workspaceTaskReadiness } from "../services/taskReadiness.service.js";

const router = Router();
router.get("/readiness", verifyJwt, authorize("ADMIN", "MANAGER"), async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.json(new ApiResponse(200, await workspaceTaskReadiness(req.user!, req.query), "Workspace readiness fetched"));
});
export default router;
