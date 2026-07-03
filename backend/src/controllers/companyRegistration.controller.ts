import type { Request, Response } from "express";
import { registerCompany, type RegisteredOwner } from "../services/companyRegistration.service.js";
import { generateAccessToken, generateRefreshToken } from "../utils/auth.js";
import { getCookieOptions } from "../utils/cookies.js";
import { prisma } from "../prisma/prisma.js";
import { ApiResponse } from "../utils/ApiResponse.js";

/** Account persistence succeeds independently of session issuing/delivery. */
export async function establishRegisteredSession(owner: RegisteredOwner) {
  const accessToken = generateAccessToken(owner, owner.role);
  const refreshToken = generateRefreshToken(owner, owner.role);
  const saved = await prisma.manager.updateMany({
    where: { id: owner.id, companyId: owner.companyId, role: "ADMIN", credentialVersion: 0, isActive: true, refreshToken: null, company: { isActive: true } },
    data: { refreshToken },
  });
  if (!saved.count) throw new Error("Session was changed after registration");
  return { accessToken, refreshToken };
}

export async function signupCompany(req: Request, res: Response) {
  const owner = await registerCompany(req.body);
  let tokens: Awaited<ReturnType<typeof establishRegisteredSession>>;
  try { tokens = await establishRegisteredSession(owner); }
  catch {
    // Returning failure for an already committed account invites another signup
    // attempt. Report the durable result without claiming the session exists.
    res.status(201).json(new ApiResponse(201, { ...owner, sessionEstablished: false }, "Account created. Sign in to continue."));
    return;
  }
  const options = getCookieOptions();
  res.status(201)
    .cookie("accessToken", tokens.accessToken, options)
    .cookie("refreshToken", tokens.refreshToken, options)
    .json(new ApiResponse(201, { ...owner, sessionEstablished: true }, "Manager registered successfully"));
}
