import { Router } from 'express';
import { z } from 'zod';
import { authRateLimit } from '../services/authRateLimit.js';
import { staffLoginCodeService } from '../services/staffLogin/loginCode.service.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { getCookieOptions } from '../utils/cookies.js';

const requestBody = z.strictObject({ phone: z.unknown().optional() });
const verifyBody = z.strictObject({ phone: z.unknown().optional(), code: z.unknown().optional() });

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
    const result = schema.safeParse(body);
    // Unknown field names are client input and can contain sensitive data.
    if (!result.success) throw new ApiError(400, 'Check the request details', [{ code: 'INVALID_REQUEST' }]);
    return result.data;
}

const router = Router();
router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    next();
});

router.post('/request-code', authRateLimit.staffCodeRequest, async (req, res) => {
    const { phone } = parseBody(requestBody, req.body);
    try {
        const data = await staffLoginCodeService.requestCode(phone);
        res.status(202).json(new ApiResponse(202, data));
    } catch (error) {
        if (error instanceof ApiError && error.errors[0]?.code === 'CODE_RESEND_WAIT') {
            res.setHeader('Retry-After', String(error.errors[0].retryAfterSeconds));
        }
        throw error;
    }
});

router.post('/verify-code', authRateLimit.staffCodeVerify, async (req, res) => {
    const { phone, code } = parseBody(verifyBody, req.body);
    const data = await staffLoginCodeService.verifyCode(phone, code);
    const options = getCookieOptions();
    res.status(200)
        .cookie('accessToken', data.accessToken, options)
        .cookie('refreshToken', data.refreshToken, options)
        .json(new ApiResponse(200, data, 'Login successful'));
});

export default router;
