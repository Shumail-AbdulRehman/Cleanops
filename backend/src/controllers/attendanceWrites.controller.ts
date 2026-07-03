import type { Request, Response } from "express";
import { checkInSchema, checkOutSchema } from "../validations/attendance.validation.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { recordAttendance } from "../services/attendanceWrites.service.js";
import { attendancePhotoPresentation } from "../services/attendanceMedia.service.js";

async function writeAttendance(req: Request, res: Response, kind: "check-in" | "check-out") {
  if (!req.user) throw new ApiError(401, "Sign in to continue");
  if (req.user.role !== "STAFF") throw new ApiError(403, "Staff account required");
  const result = (kind === "check-in" ? checkInSchema : checkOutSchema).safeParse(req.body);
  if (!result.success) throw new ApiError(400, "Check your location details", result.error.issues.map(issue => ({ field: issue.path.join("."), message: issue.message })));
  if (!req.file) throw new ApiError(400, "Attendance photo is required");
  const saved = await recordAttendance(req.user, kind, result.data, req.file.buffer);
  res.status(200).json(new ApiResponse(200, attendancePhotoPresentation(saved.record), saved.replayed ? "Attendance already recorded; current record returned" : kind === "check-in" ? "Checked in successfully" : "Checked out successfully"));
}
export const checkIn = (req: Request, res: Response) => writeAttendance(req, res, "check-in");
export const checkOut = (req: Request, res: Response) => writeAttendance(req, res, "check-out");
