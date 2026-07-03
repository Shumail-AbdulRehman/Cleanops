import { assertCredentialSession } from "../services/credentialSession.service.js";

import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { Request, Response } from "express";
import { prisma } from "../prisma/prisma.js"; 
import { generateAccessToken,generateRefreshToken,verifySessionToken } from "../utils/auth.js";
import { getCookieOptions } from "../utils/cookies.js";
import { renewStaffPushSession } from "../services/staff-notifications/session.js";

export const getCurrentUser = async (req: Request, res: Response) => {
    const user = req?.user;
    if (!user) {
        throw new ApiError(401, "no user found");
    }

    res.status(200).json(new ApiResponse(200, user, "user found"));
};

export const refreshToken = async (req: Request, res: Response) => {
  const incomingRefreshToken =
    req.cookies?.refreshToken ||
    req.body?.refreshToken ||
    req.header("x-refresh-token");

  if (!incomingRefreshToken) {
    throw new ApiError(401, "Refresh token missing");
  }

  const decodedToken = verifySessionToken(incomingRefreshToken, "refresh");

  const { id, role } = decodedToken;

  let user;

  if (role === "MANAGER" || role === "ADMIN") {
    user = await prisma.manager.findUnique({
      where: { id },
      include: { company: { select: { isActive: true } } },
    });

    if (!user) {
      throw new ApiError(401, "Unauthorized");
    }

    if (user.role !== role) throw new ApiError(401, "Account role changed; sign in again");
    if (!user.isActive) throw new ApiError(403, "Account is deactivated");
    assertCredentialSession(user, decodedToken);
    if (user.refreshToken !== incomingRefreshToken) throw new ApiError(401, "Session changed; sign in again");

    const accessToken = generateAccessToken(user, role);
    const newRefreshToken = generateRefreshToken(user, role);
    const rotated = await prisma.manager.updateMany({
      where: { id: user.id, companyId: user.companyId, role, credentialVersion: decodedToken.credentialVersion, refreshToken: incomingRefreshToken,
        isActive: true },
      data: { refreshToken: newRefreshToken },
    });
    if (!rotated.count) throw new ApiError(401, "Session changed; sign in again");

    const cookieOptions = getCookieOptions(true);

    const safeUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role,
      companyId: user.companyId,
    };

    return res
      .status(200)
      .cookie("accessToken", accessToken, cookieOptions)
      .cookie("refreshToken", newRefreshToken, cookieOptions)
      .json(
        new ApiResponse(
          200,
          {
            ...safeUser,
            accessToken,
            refreshToken: newRefreshToken,
          },
          "Token refreshed successfully"
        )
      );
  }

  if (role === "STAFF") {
    user = await prisma.staff.findUnique({
      where: { id },
      include: { company: { select: { isActive: true } } },
    });

    if (!user) {
      throw new ApiError(401, "Unauthorized");
    }

    if (!user.isActive)
      throw new ApiError(403, "Account is deactivated");

    if (user.role !== role) throw new ApiError(401, "Account role changed; sign in again");
    assertCredentialSession(user, decodedToken);
    if (user.refreshToken !== incomingRefreshToken) throw new ApiError(401, "Session changed; sign in again");

    const accessToken = generateAccessToken(user, role);
    const newRefreshToken = generateRefreshToken(user, role);

    const staffUserId = user.id;
    const staffCompanyId = user.companyId;
    await prisma.$transaction(async (tx) => {
      const rotated = await tx.staff.updateMany({
        where: { id: staffUserId, companyId: staffCompanyId, role: "STAFF", credentialVersion: decodedToken.credentialVersion, refreshToken: incomingRefreshToken, isActive: true },
        data: { refreshToken: newRefreshToken },
      });
      if (!rotated.count) throw new ApiError(401, "Session changed; sign in again");
      await renewStaffPushSession(tx, staffUserId, incomingRefreshToken, newRefreshToken);
    });

    const cookieOptions = getCookieOptions(true);

    const safeUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role,
      companyId: user.companyId,
      locationId: user.locationId,
    };

    return res
      .status(200)
      .cookie("accessToken", accessToken, cookieOptions)
      .cookie("refreshToken", newRefreshToken, cookieOptions)
      .json(
        new ApiResponse(
          200,
          {
            ...safeUser,
            accessToken,
            refreshToken: newRefreshToken,
          },
          "Token refreshed successfully"
        )
      );
  }

  throw new ApiError(401, "Invalid role");
};

export const logOut = async (req: Request, res: Response) => {
  const cookieOptions = getCookieOptions(true);
  const incomingRefreshToken =
    req.cookies?.refreshToken || req.body?.refreshToken || req.header("x-refresh-token");

  // Access-only or stale logout must not revoke a later sign-in. Only the
  // current, verified refresh family can revoke the stored session.
  if (incomingRefreshToken) {
    let principal;
    try { principal = verifySessionToken(incomingRefreshToken, "refresh"); }
    catch { /* Clear local cookies even when the presented family has expired. */ }
    if (principal?.role === "ADMIN" || principal?.role === "MANAGER") {
      await prisma.manager.updateMany({
        where: { id: principal.id, role: principal.role, refreshToken: incomingRefreshToken },
        data: { refreshToken: null, credentialVersion: { increment: 1 } },
      });
    } else if (principal?.role === "STAFF") {
      const staffId = principal.id;
      await prisma.$transaction(async tx => {
        const revoked = await tx.staff.updateMany({
          where: { id: staffId, role: "STAFF", refreshToken: incomingRefreshToken },
          data: { refreshToken: null, credentialVersion: { increment: 1 } },
        });
        if (revoked.count) await tx.staffPushDevice.updateMany({ where: { staffId }, data: { enabled: false } });
      });
    }
  }
  return res
    .clearCookie("accessToken", cookieOptions)
    .clearCookie("refreshToken", cookieOptions)
    .status(200)
    .json(new ApiResponse(200, {}, "User logged out successfully"));
};
