import type { Request, Response } from "express";
import { ApiError } from "../utils/ApiError.js";
import { readAttendancePhoto } from "../services/attendanceMedia.service.js";

export async function getAttendancePhoto(req: Request, res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!req.user) throw new ApiError(401, "Sign in to continue");
  const kind = req.params.kind;
  if (kind !== "check-in" && kind !== "check-out") throw new ApiError(404, "Photo unavailable");
  const bytes = await readAttendancePhoto(req.user, Number(req.params.id), kind);
  res.type("image/jpeg").send(bytes);
}
