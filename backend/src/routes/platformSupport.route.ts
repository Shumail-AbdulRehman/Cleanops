import { Router } from 'express';
import { verifyOperator } from '../middlewares/operatorAuth.middleware.js';
import { getPlatformDiagnostics, getPlatformInquiry, getSupportContact, listPlatformAudit, listPlatformInquiries, updatePlatformInquiry } from '../services/platformSupport.service.js';
import { ApiResponse } from '../utils/ApiResponse.js';

const noStore: import('express').RequestHandler = (_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); };
const router = Router();
router.use(noStore, verifyOperator);
router.get('/diagnostics', async (req, res) => { res.json(new ApiResponse(200, await getPlatformDiagnostics(req.operator!), 'Service observations fetched')); });
router.get('/audit', async (req, res) => { res.json(new ApiResponse(200, await listPlatformAudit(req.operator!, req.query), 'Platform activity fetched')); });
router.get('/inquiries', async (req, res) => { res.json(new ApiResponse(200, await listPlatformInquiries(req.operator!, req.query), 'Inquiries fetched')); });
router.get('/inquiries/:id', async (req, res) => { res.json(new ApiResponse(200, await getPlatformInquiry(req.operator!, req.params.id), 'Inquiry fetched')); });
router.patch('/inquiries/:id', async (req, res) => { res.json(new ApiResponse(200, await updatePlatformInquiry(req.operator!, req.params.id, req.body), 'Inquiry handling saved')); });

// Public configuration-only contact. Never mount inquiry/diagnostic operations here.
export const customerSupportRouter = Router();
customerSupportRouter.use(noStore);
customerSupportRouter.get('/contact', (_req, res) => { res.json(new ApiResponse(200, getSupportContact(), 'Support contact availability fetched')); });
export default router;
