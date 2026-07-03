import { assignTemplateStaff } from '../services/templateAssignment.service.js';
import { transferStaff } from '../services/workforceLifecycle.service.js';
import { Request, Response } from "express";
import { ApiResponse } from "../utils/ApiResponse.js";

export const assignStaffToLocation = async (req: Request, res: Response) => {
  const updated = await transferStaff(req.user!, Number(req.params.staffId), Number(req.params.locationId), req.body);
  res.status(200).json(new ApiResponse(200, updated, "Staff transfer processed"));
};

export const assignStaffToTaskTemplate = async (req: Request, res: Response) => {
  const updated=await assignTemplateStaff(req.user!,Number(req.params.templateId),Number(req.params.staffId));
  res.status(200).json(new ApiResponse(200,updated,'Staff assigned to schedule and eligible existing tasks'));
};
