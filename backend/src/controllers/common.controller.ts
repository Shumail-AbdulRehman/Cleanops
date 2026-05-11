
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { Request, Response } from "express";
import { TokenPayload } from "../types/jwt.js";
import { prisma } from "../prisma/prisma.js"; 
import jwt from "jsonwebtoken";
import { generateAccessToken,generateRefreshToken } from "../utils/auth.js";
import { getCookieOptions } from "../utils/cookies.js";

export const getCurrentUser = async (req: Request, res: Response) => {
    const user = req?.user;
    if (!user) {
        throw new ApiError(401, "no user found");
    }

    res.status(200).json(new ApiResponse(200, user, "user found"));
};

export const refreshToken = async (req: Request, res: Response) => {
  const incomingRefreshToken =
    req.cookies.refreshToken ||
    req.body?.refreshToken ||
    req.header("x-refresh-token");

  if (!incomingRefreshToken) {
    throw new ApiError(401, "Refresh token missing");
  }

  let decodedToken: TokenPayload;

  try {
    decodedToken = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET!
    ) as TokenPayload;
  } catch {
    throw new ApiError(401, "Access Token Expired");
  }

  const { id, role } = decodedToken;

  let user;

  if (role === "MANAGER") {
    user = await prisma.manager.findUnique({
      where: { id },
    });

    if (!user) {
      throw new ApiError(401, "Unauthorized");
    }

    if (user.refreshToken !== incomingRefreshToken) {
      await prisma.manager.update({
        where: { id: user.id },
        data: { refreshToken: null },
      });
      throw new ApiError(403, "Token reuse detected");
    }

    const accessToken = generateAccessToken(user, role);
    const newRefreshToken = generateRefreshToken(user, role);

    await prisma.manager.update({
      where: { id: user.id },
      data: { refreshToken: newRefreshToken },
    });

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
    });

    if (!user) {
      throw new ApiError(401, "Unauthorized");
    }

    if (user.refreshToken !== incomingRefreshToken) {
      await prisma.staff.update({
        where: { id: user.id },
        data: { refreshToken: null },
      });
      throw new ApiError(403, "Token reuse detected");
    }

    const accessToken = generateAccessToken(user, role);
    const newRefreshToken = generateRefreshToken(user, role);

    await prisma.staff.update({
      where: { id: user.id },
      data: { refreshToken: newRefreshToken },
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
  const accessToken =
    req.cookies?.accessToken ||
    req.header("Authorization")?.replace("Bearer ", "");
  const refreshTokenCookie =
    req.cookies?.refreshToken ||
    req.body?.refreshToken ||
    req.header("x-refresh-token");

  let decodedAccessToken: TokenPayload | null = null;
  let decodedRefreshToken: TokenPayload | null = null;

  if (accessToken) {
    try {
      decodedAccessToken = jwt.verify(
        accessToken,
        process.env.ACCESS_TOKEN_SECRET!
      ) as TokenPayload;
    } catch {
      decodedAccessToken = null;
    }
  }

  if (refreshTokenCookie) {
    try {
      decodedRefreshToken = jwt.verify(
        refreshTokenCookie,
        process.env.REFRESH_TOKEN_SECRET!
      ) as TokenPayload;
    } catch {
      decodedRefreshToken = null;
    }
  }

  const tokenPayload = decodedAccessToken ?? decodedRefreshToken;

  if (tokenPayload?.role === "MANAGER") {
    await prisma.manager
      .update({
        where: { id: tokenPayload.id },
        data: { refreshToken: null },
      })
      .catch(() => null);
  } else if (tokenPayload?.role === "STAFF") {
    await prisma.staff
      .update({
        where: { id: tokenPayload.id },
        data: { refreshToken: null },
      })
      .catch(() => null);
  }

  return res
    .clearCookie("accessToken", cookieOptions)
    .clearCookie("refreshToken", cookieOptions)
    .status(200)
    .json(new ApiResponse(200, {}, "User logged out successfully"));
};
