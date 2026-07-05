import { localOperatorSessions } from '../services/localOperatorSession.service.js';
import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError.js';
import { verifyOperatorIdentity, type OperatorPrincipal } from '../services/operatorIdentity.service.js';

declare global {
    namespace Express { interface Request { operator?: OperatorPrincipal } }
}

export function createOperatorAuthMiddleware(verify = verifyOperatorIdentity) {
    return async (req: Request, _res: Response, next: NextFunction) => {
        try {
            const authorization = req.header('Authorization');
            // Tenant cookies and pre-authenticated tenant contexts never grant operator authority.
            if (req.user || !authorization || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization)) {
                throw new ApiError(401, 'Platform bearer identity required');
            }
            req.operator = await verify(authorization.slice(7));
            next();
        } catch (error) { next(error); }
    };
}

const providerOperatorAuth = createOperatorAuthMiddleware();
export const verifyOperator = (req: Request, res: Response, next: NextFunction) => {
    try {
        const local = localOperatorSessions.authenticate(req);
        if (local) { req.operator = local; next(); return; }
        return providerOperatorAuth(req, res, next);
    } catch (error) { next(error); }
};
