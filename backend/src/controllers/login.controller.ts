import type { Request, Response } from "express";
import { login } from "../services/login.service.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { getCookieOptions } from "../utils/cookies.js";

export async function loginUser(req: Request, res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  const { user, accessToken, refreshToken } = await login(req.body);
  const options = getCookieOptions();
  res.status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(new ApiResponse(200, user, "Login successful"));
}
