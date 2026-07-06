import { Router } from 'express';
import { verifyOperator } from '../middlewares/operatorAuth.middleware.js';
import { getPlatformCompany, listPlatformCompanies, setPlatformCompanyStatus } from '../services/platformCompany.service.js';
import { getPlatformCompanyInsights } from '../services/platformInsights/companyInsights.js';
import { ApiResponse } from '../utils/ApiResponse.js';

const router = Router();
// Mount under the separate platform namespace in spec26, never under tenant auth.
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); }, verifyOperator);
router.get('/', async (req, res) => {
    res.json(new ApiResponse(200, await listPlatformCompanies(req.operator!, req.query), 'Company accounts fetched'));
});
router.get('/:id/insights', async (req, res) => {
    res.json(new ApiResponse(200, await getPlatformCompanyInsights(req.operator!, req.params.id), 'Company insights fetched'));
});
router.get('/:id', async (req, res) => {
    res.json(new ApiResponse(200, await getPlatformCompany(req.operator!, req.params.id), 'Company account fetched'));
});
router.patch('/:id/status', async (req, res) => {
    res.json(new ApiResponse(200, await setPlatformCompanyStatus(req.operator!, req.params.id, req.body), 'Company status saved'));
});
export default router;
