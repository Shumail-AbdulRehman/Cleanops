import { accountAccess } from '../middlewares/accountAccess.middleware.js';
import { Router } from 'express';
import { verifyJwt } from '../middlewares/auth.middleware.js';
import authorize from '../middlewares/authorize.middleware.js';
import { deactivateWorkforce, transferStaff } from '../services/workforceLifecycle.service.js';
import { ApiResponse } from '../utils/ApiResponse.js';
const router = Router();
router.use(verifyJwt, authorize('ADMIN', 'MANAGER'), accountAccess('MANAGE_WORK'));
router.post('/staff/:id/transfer/:locationId', async (req, res) => {
    const result = await transferStaff(req.user!, Number(req.params.id), Number(req.params.locationId), req.body);
    res.json(new ApiResponse(200, result, 'Staff transfer processed'));
});
router.post('/staff/:id/deactivate', async (req, res) => {
    res.json(new ApiResponse(200, await deactivateWorkforce(req.user!, 'staff', Number(req.params.id), req.body), 'Staff deactivated; history preserved'));
});
router.post('/manager/:id/deactivate', authorize('ADMIN'), async (req, res) => {
    res.json(new ApiResponse(200, await deactivateWorkforce(req.user!, 'manager', Number(req.params.id), req.body), 'Manager deactivated; history preserved'));
});
export default router;
