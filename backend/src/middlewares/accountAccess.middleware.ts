import type { NextFunction, Request, Response } from 'express';
import { assertAccountAction, type AccountAction } from '../services/accountAccess.service.js';
import { ApiError } from '../utils/ApiError.js';

// Completion needs the persisted work adapter, not a body-provided start time.
export function accountAccess(action: Exclude<AccountAction, 'COMPLETE_WORK'>) {
    return async (req: Request, _res: Response, next: NextFunction) => {
        try {
            if (!req.user || req.operator) throw new ApiError(401, 'Tenant identity required');
            await assertAccountAction(req.user, action);
            next();
        } catch (error) { next(error); }
    };
}
