import { assertCredentialSession } from "../services/credentialSession.service.js";
import { verifySessionToken } from "../utils/auth.js";
import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/ApiError.js";
import { prisma } from "../prisma/prisma.js";

const authenticateJwt = (allowPasswordReplacement: boolean, ownSecurity: boolean | "OWNER_BILLING" = false) => async (req: Request, res: Response, next: NextFunction) => {
    if (req.operator) throw new ApiError(401, "Tenant identity required");
    const token =
        req.cookies?.accessToken ||
        req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
        throw new ApiError(401, "Unauthorized access");
    }

    const decoded = verifySessionToken(token, "access");

    const { id, role } = decoded;
    let user;
    let locationIds: number[] | undefined;

    if (role === "MANAGER" || role === "ADMIN") {
        user = await prisma.manager.findUnique({
            where: { id },
            select: { id: true, name: true, email: true, companyId: true, role: true, credentialVersion: true, mustChangePassword: true, company: { select: { isActive: true, operationalStatus: true } }, isActive: true },
        });

        if (user && role === "MANAGER") {
            const assignments = await prisma.managerLocation.findMany({
                where: { managerId: id },
                select: { locationId: true },
            });
            locationIds = assignments.map((assignment) => assignment.locationId);
        }
    } else if (role === "STAFF") {
        user = await prisma.staff.findUnique({
            where: { id },
            select: { id: true, name: true, email: true, companyId: true, locationId: true, role: true, credentialVersion: true, mustChangePassword: true, company: { select: { isActive: true, operationalStatus: true } }, isActive: true },
        });
    }

    if (user && !user.isActive) throw new ApiError(403, "Account is deactivated");
    // Active principals retain only their own security while operations are
    // inactive. Billing separately requires ADMIN; no operational route uses
    // this adapter. Epoch, role and forced-password checks remain mandatory.
    const accountException = ownSecurity === true || (ownSecurity === 'OWNER_BILLING' && role === 'ADMIN');
    if (user && !accountException && (!user.company.isActive || user.company.operationalStatus === 'SUSPENDED'))
        throw new ApiError(403, "Company operations are suspended", [{code:'ACCOUNT_SUSPENDED'}]);
    if (user && user.role !== role) throw new ApiError(401, "Account role changed; sign in again");

    if (!user) {
        throw new ApiError(401, "Invalid access token");
    }

    assertCredentialSession(user, decoded, allowPasswordReplacement);
    const { isActive, company, credentialVersion, mustChangePassword, ...safeUser } = user as typeof user & { isActive?: boolean };
    (req as any).user = { ...safeUser, role, ...(locationIds ? { locationIds } : {}) };
    next();
};

export const verifyJwt = authenticateJwt(false);
// Only the current-password endpoint may admit a forced-replacement session.
export const verifyPasswordChangeJwt = authenticateJwt(true, true);
export const verifyOwnSecurityJwt = authenticateJwt(false, true);

// Legacy summary remains readable by managers only while operations are active.
export const verifyOwnerBillingJwt = authenticateJwt(false, "OWNER_BILLING");
