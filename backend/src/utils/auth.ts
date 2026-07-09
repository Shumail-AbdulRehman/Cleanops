import bcrypt from "bcrypt";
import jwt, { SignOptions } from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { ApiError } from "./ApiError.js";

export async function isPasswordCorrect(
  plainPassword: string,
  hashedPassword: string,
) {
  return bcrypt.compare(plainPassword, hashedPassword);
}

export function generateAccessToken(
  user: { id: number; email: string | null; name: string; credentialVersion?: number },
  role: "ADMIN" | "MANAGER" | "STAFF",
) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role, credentialVersion: user.credentialVersion ?? 0, tokenUse: "access" },
    process.env.ACCESS_TOKEN_SECRET as string,
    { algorithm: "HS256", expiresIn: process.env.ACCESS_TOKEN_EXPIRY } as SignOptions,
  );
}

export function generateRefreshToken(
  user: { id: number; credentialVersion?: number },
  role: "ADMIN" | "MANAGER" | "STAFF",
) {
  return jwt.sign(
    { id: user.id, role, credentialVersion: user.credentialVersion ?? 0, tokenUse: "refresh" },
    process.env.REFRESH_TOKEN_SECRET as string,
    {
      expiresIn:
        role === "STAFF"
          ? process.env.STAFF_REFRESH_TOKEN_EXPIRY || "14d"
          : process.env.REFRESH_TOKEN_EXPIRY,
      algorithm: "HS256",
      jwtid: randomUUID(),
    } as SignOptions,
  );
}

export type SessionToken = jwt.JwtPayload & {
  id: number;
  role: "ADMIN" | "MANAGER" | "STAFF";
  tokenUse: "access" | "refresh";
  credentialVersion: number;
};

/** Keep refresh tokens out of access endpoints even under misconfiguration. */
export function verifySessionToken(token: unknown, purpose: "access" | "refresh"): SessionToken {
  try {
    if (typeof token !== "string" || !token) throw new Error("Missing token");
    const secret = purpose === "access" ? process.env.ACCESS_TOKEN_SECRET : process.env.REFRESH_TOKEN_SECRET;
    if (!secret) throw new Error("Missing signing key");
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof decoded !== "object" || !Number.isSafeInteger(decoded.id) || decoded.id <= 0 ||
        !["ADMIN", "MANAGER", "STAFF"].includes(decoded.role) || decoded.tokenUse !== purpose ||
        typeof decoded.exp !== "number" || !Number.isFinite(decoded.exp) ||
        (purpose === "refresh" && (typeof decoded.jti !== "string" || !decoded.jti))) {
      throw new Error("Invalid principal");
    }
    const version = decoded.credentialVersion === undefined ? 0 : decoded.credentialVersion;
    if (!Number.isSafeInteger(version) || version < 0) throw new Error("Invalid credential version");
    return { ...decoded, credentialVersion: version } as SessionToken;
  } catch {
    // Preserve the existing clients' refresh trigger while stable codes roll out.
    throw new ApiError(401, "Access Token Expired");
  }
}
