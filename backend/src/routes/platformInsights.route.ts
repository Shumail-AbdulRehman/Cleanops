import { Router, type RequestHandler } from 'express';
import { verifyOperator } from '../middlewares/operatorAuth.middleware.js';
import { listPlatformPayments, listPlatformSubscriptions } from '../services/platformInsights/billingLists.js';
import { getPlatformOverview } from '../services/platformInsights/overview.js';
import { ApiResponse } from '../utils/ApiResponse.js';

const router = Router();
const noStore: RequestHandler = (_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    next();
};

router.get('/overview', noStore, verifyOperator, async (req, res) => {
    res.json(new ApiResponse(200, await getPlatformOverview(req.operator!), 'Platform overview fetched'));
});
router.get('/subscriptions', noStore, verifyOperator, async (req, res) => {
    res.json(new ApiResponse(200, await listPlatformSubscriptions(req.operator!, req.query), 'Platform subscriptions fetched'));
});
router.get('/payments', noStore, verifyOperator, async (req, res) => {
    res.json(new ApiResponse(200, await listPlatformPayments(req.operator!, req.query), 'Platform payments fetched'));
});

export default router;
