import { Response, Request, NextFunction } from "express";
import { ApiError } from "../utils/ApiError.js";

const authorize = (...roles: Array<"ADMIN" | "MANAGER" | "STAFF">) => {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!roles.includes((req as any).user.role)) {
            throw new ApiError(403, "Not authorized to access this resource");
        }
        next();
    };
};

export default authorize;
