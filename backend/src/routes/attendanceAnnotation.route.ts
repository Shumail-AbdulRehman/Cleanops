import { accountAccess } from '../middlewares/accountAccess.middleware.js';
import { Router } from 'express';
import { verifyJwt } from '../middlewares/auth.middleware.js';
import { appendAttendanceAnnotation, listAttendanceAnnotations } from '../services/attendanceAnnotation.service.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';

const router = Router();
router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.operator) throw new ApiError(401, 'Tenant identity required');
    next();
}, verifyJwt);
// Mounted as /api/attendance/:attendanceId/annotations by composition26.
router.get('/:attendanceId/annotations', async (req, res) => {
    res.json(new ApiResponse(200, await listAttendanceAnnotations(req.user!, req.params.attendanceId, req.query), 'Attendance context fetched'));
});
router.post('/:attendanceId/annotations', accountAccess('ANNOTATE_ATTENDANCE'), async (req, res) => {
    const result = await appendAttendanceAnnotation(req.user!, req.params.attendanceId, req.body);
    const status = result.reused ? 200 : 201;
    res.status(status).json(new ApiResponse(status, result, 'Attendance context recorded'));
});
export default router;
