import billingLifecycleRouter from "./billingLifecycle.route.js";
import { createEnterpriseInquiry } from "../controllers/enterpriseInquiry.controller.js";
import { Router } from "express";
import {
  getPricingContext,
  getPublicPlanPrices,
  getSubscription,
  createCustomerPortalSession,
} from "../controllers/subscription.controller.js";
import { verifyJwt, verifyOwnerBillingJwt } from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/authorize.middleware.js";

const router = Router();
router.use("/manage", billingLifecycleRouter);

router.get("/pricing-context", getPricingContext);
router.get("/prices", (req, res) => getPublicPlanPrices(req, res));
router.post("/enterprise-inquiries", createEnterpriseInquiry);
router.get("/", verifyOwnerBillingJwt, authorize("ADMIN", "MANAGER"), getSubscription);
router.post("/portal-session", verifyOwnerBillingJwt, authorize("ADMIN"), createCustomerPortalSession);

export default router;
