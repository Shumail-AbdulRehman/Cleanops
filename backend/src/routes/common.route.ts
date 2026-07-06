import credentialHandoffRouter from "./credentialHandoff.route.js";
import staffLoginRouter from "./staffLogin.route.js";
import { Router } from "express";
import { verifyOwnSecurityJwt } from "../middlewares/auth.middleware.js";
import { getCurrentUser,logOut,refreshToken } from "../controllers/common.controller.js";
import { loginUser } from "../controllers/login.controller.js";
import { authRateLimit } from "../services/authRateLimit.js";





const router = Router();
router.use("/staff-login", staffLoginRouter);
router.use(credentialHandoffRouter);
router.post("/login", authRateLimit.login, loginUser);


router.post("/logout",logOut);
router.post("/refresh-token",refreshToken);
router.get("/get-current-user",verifyOwnSecurityJwt,getCurrentUser);
export default router;
