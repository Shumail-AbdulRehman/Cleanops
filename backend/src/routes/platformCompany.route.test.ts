import express, { type ErrorRequestHandler } from 'express';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyOperatorIdentity } from '../services/operatorIdentity.service.js';
import { getPlatformCompanyInsights } from '../services/platformInsights/companyInsights.js';
import { ApiError } from '../utils/ApiError.js';
import platformCompanyRouter from './platformCompany.route.js';

vi.mock('../services/localOperatorSession.service.js', () => ({
    localOperatorSessions: { authenticate: () => null },
}));
vi.mock('../services/operatorIdentity.service.js', () => ({ verifyOperatorIdentity: vi.fn() }));
vi.mock('../services/platformCompany.service.js', () => ({
    getPlatformCompany: vi.fn(), listPlatformCompanies: vi.fn(), setPlatformCompanyStatus: vi.fn(),
}));
vi.mock('../services/platformInsights/companyInsights.js', () => ({ getPlatformCompanyInsights: vi.fn() }));

const operator = { kind: 'PLATFORM_OPERATOR', issuer: 'test-issuer', subject: 'test-operator' } as const;
const app = express();
app.use('/api/platform/companies', platformCompanyRouter);
const handleError: ErrorRequestHandler = (error: ApiError, _req, res, _next) => {
    res.status(error.statusCode).json({ message: error.message });
};
app.use(handleError);

function requestInsights(headers: IncomingMessage['headers'] = {}) {
    const req = new IncomingMessage(new Socket());
    req.method = 'GET';
    req.url = '/api/platform/companies/4/insights';
    req.headers = headers;
    const res = new ServerResponse(req);
    return new Promise<{ status: number; cacheControl: unknown; body: unknown }>(resolve => {
        // Dispatch through Express without opening a listener.
        vi.spyOn(res, 'end').mockImplementation((body?: unknown) => {
            resolve({
                status: res.statusCode,
                cacheControl: res.getHeader('Cache-Control'),
                body: JSON.parse(String(body)),
            });
            return res;
        });
        app(req, res);
    });
}

beforeEach(() => vi.resetAllMocks());

describe('company insights route', () => {
    it('rejects a tenant session before invoking the service', async () => {
        const response = await requestInsights({ cookie: 'accessToken=tenant-session' });
        expect(response.status).toBe(401);
        expect(response.cacheControl).toBe('private, no-store');
        expect(verifyOperatorIdentity).not.toHaveBeenCalled();
        expect(getPlatformCompanyInsights).not.toHaveBeenCalled();
    });

    it('rejects a bearer that fails operator verification before invoking the service', async () => {
        vi.mocked(verifyOperatorIdentity).mockRejectedValue(new ApiError(403, 'Platform operator required'));
        const response = await requestInsights({ authorization: 'Bearer abc.def.ghi' });
        expect(response.status).toBe(403);
        expect(verifyOperatorIdentity).toHaveBeenCalledWith('abc.def.ghi');
        expect(getPlatformCompanyInsights).not.toHaveBeenCalled();
    });

    it('passes the verified operator and id into the service and prevents caching', async () => {
        const insights = {
            owner: null, limits: { locations: 1, staff: 3, managers: 1 }, usage: { locations: 0, staff: 0, managers: 0 },
            lastActiveAt: null, activity30: [], calendar35: [], photos: { passed: 0, retake: 0, manager: 0, cleaning: 0 },
            onTimeShare: null, payments: [], paidToDate: null, paddle: null,
        };
        vi.mocked(verifyOperatorIdentity).mockResolvedValue(operator);
        vi.mocked(getPlatformCompanyInsights).mockResolvedValue(insights);
        const response = await requestInsights({ authorization: 'Bearer abc.def.ghi' });
        expect(verifyOperatorIdentity).toHaveBeenCalledBefore(vi.mocked(getPlatformCompanyInsights));
        expect(getPlatformCompanyInsights).toHaveBeenCalledWith(operator, '4');
        expect(response).toEqual({
            status: 200, cacheControl: 'private, no-store',
            body: { statusCode: 200, success: true, message: 'Company insights fetched', data: insights },
        });
    });
});
