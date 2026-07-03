import { attendancePhotoPresentation } from "../services/attendanceMedia.service.js";
import type { Request, Response } from "express";
import { prisma } from "../prisma/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";

export const getStaffSelfAttendance = async (req: Request, res: Response) => {
  const actor = req.user;
  if (!actor) throw new ApiError(401, "Sign in to continue");
  if (actor.role !== "STAFF") throw new ApiError(403, "Staff account required");

  const attendance = await prisma.attendance.findMany({
    where: {
      staffId: actor.id,
      staff: {
        companyId: actor.companyId, role: "STAFF", isActive: true,
        company: { isActive: true },
      },
      location: { companyId: actor.companyId },
    },
    orderBy: { date: "desc" },
    take: 30,
    include: { location: { select: { id: true, name: true } } },
  });
  res.status(200).json(new ApiResponse(200, attendance.map(attendancePhotoPresentation), "Attendance fetched successfully"));
};
