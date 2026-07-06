import { Router } from 'express';
import { z } from 'zod';
import { verifyOwnerBillingJwt } from '../middlewares/auth.middleware.js';
import authorize from '../middlewares/authorize.middleware.js';
import { createBillingPortal, getBillingCatalog, getBillingLifecycle } from '../services/billingLifecycle.service.js';
import { createBillingCheckout } from '../services/billingCheckout.service.js';
import { confirmBillingCheckout } from '../services/billingConfirm.service.js';
import { reconcileBillingReservations } from '../services/billingReconcile.service.js';
import { ApiResponse } from '../utils/ApiResponse.js';
const router = Router();
const emptyBody = z.object({}).strict();
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); }, verifyOwnerBillingJwt, authorize('ADMIN'));
router.get('/lifecycle', async (req, res) => { res.json(new ApiResponse(200, await getBillingLifecycle(req.user!), 'Billing details fetched')); });
router.get('/catalog', async (req, res) => { res.json(new ApiResponse(200, await getBillingCatalog(req.user!), 'Configured catalog fetched')); });
router.post('/checkout', async (req, res) => { res.status(201).json(new ApiResponse(201, await createBillingCheckout(req.user!, req.body), 'Checkout prepared')); });
router.post('/checkout/confirm', async (req, res) => {
    emptyBody.parse(req.body);
    res.json(new ApiResponse(200, await confirmBillingCheckout(req.user!), 'Checkout confirmation fetched'));
});
router.post('/checkout/reconcile', async (req, res) => {
    emptyBody.parse(req.body);
    const outcome = await reconcileBillingReservations(req.user!);
    const lifecycle = await getBillingLifecycle(req.user!);
    res.json(new ApiResponse(200, { outcome, lifecycle }, 'Checkout reconciliation fetched'));
});
router.post('/managed-portal', async (req, res) => { res.status(201).json(new ApiResponse(201, await createBillingPortal(req.user!, req.body), 'Billing portal prepared')); });
export default router;
