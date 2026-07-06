import { accountAccess } from '../middlewares/accountAccess.middleware.js';
import { Router } from 'express';
import { verifyJwt } from '../middlewares/auth.middleware.js';
import authorize from '../middlewares/authorize.middleware.js';
import { getCompanySettings, updateCompanySettings } from '../services/companySettings.service.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';

const router = Router();
router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.operator) throw new ApiError(401, 'Tenant identity required');
    next();
}, verifyJwt, authorize('ADMIN'));
// Company identity always comes from persisted authenticated owner, never path/body/query.
router.get('/', async (req, res) => {
    res.json(new ApiResponse(200, await getCompanySettings(req.user!), 'Company settings fetched'));
});
router.patch('/', accountAccess('MANAGE_WORK'), async (req, res) => {
    res.json(new ApiResponse(200, await updateCompanySettings(req.user!, req.body), 'Company settings saved'));
});
export default router;
