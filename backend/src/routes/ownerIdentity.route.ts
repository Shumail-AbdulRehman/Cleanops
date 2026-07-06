import { Router } from 'express';
import { ownerIdentity } from '../services/ownerIdentity.service.js';
import { verifyOwnSecurityJwt } from '../middlewares/auth.middleware.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { getCookieOptions } from '../utils/cookies.js';
const router = Router();
router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.operator) throw new ApiError(401, 'Tenant identity required'); next();
});
const clientKey = (req: import('express').Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown';
router.get('/status', verifyOwnSecurityJwt, async (req, res) => { res.json(new ApiResponse(200, await ownerIdentity.status(req.user!), 'Owner identity status fetched')); });
router.post('/recovery/request', async (req, res) => {
    res.status(202).json(new ApiResponse(202, await ownerIdentity.requestRecovery(req.body, clientKey(req)), 'Request accepted for processing. Delivery is not confirmed.'));
});
router.post('/email/request', verifyOwnSecurityJwt, async (req, res) => {
    res.status(202).json(new ApiResponse(202, await ownerIdentity.requestVerification(req.user!, req.body, clientKey(req)), 'Request accepted for processing. Delivery is not confirmed.'));
});
router.post('/email/complete', async (req, res) => {
    const result = await ownerIdentity.complete(req.body, 'VERIFY_OWNER_EMAIL', clientKey(req));
    res.clearCookie('accessToken', getCookieOptions()).clearCookie('refreshToken', getCookieOptions()).json(new ApiResponse(200, result, 'Email verified. Sign in again.'));
});
router.post('/recovery/complete', async (req, res) => {
    const result = await ownerIdentity.complete(req.body, 'RESET_OWNER_PASSWORD', clientKey(req));
    res.clearCookie('accessToken', getCookieOptions()).clearCookie('refreshToken', getCookieOptions()).json(new ApiResponse(200, result, 'Password replaced. Sign in again.'));
});
// Keep driver/provider exceptions (which can contain credential data) out of generic logging.
router.use(((error, _req, _res, next) => { next(error instanceof ApiError ? error : new ApiError(503, 'Owner security processing is unavailable')); }) as import('express').ErrorRequestHandler);
export default router;
