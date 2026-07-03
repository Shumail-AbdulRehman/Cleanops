import type { Request, Response } from "express";
import { z } from "zod";
import { operationsQuery } from "../services/operationsScope.service.js";
import { managerOperations } from "../services/managerOperations.service.js";
import { ApiError } from "../utils/ApiError.js";
import { dashboardTrends } from "../services/dashboardTrends.service.js";
import { companyPerformance } from "../services/companyPerformance.service.js";

export const readCompanyPerformance = async (req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control','private, no-store');
    res.json({success:true,data:await companyPerformance(req.user!,req.query)});
  } catch(error) {
    if(error instanceof z.ZodError)throw new ApiError(400,'Invalid performance filters',error.issues);
    throw error;
  }
};

export const readDashboardTrends = async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await dashboardTrends(req.user!, req.query) });
  } catch (e) {
    if (e instanceof z.ZodError)
      throw new ApiError(400, "Invalid trend filters", e.issues);
    throw e;
  }
};
export const operationsRead =
  (kind: "overview" | "staff" | "tasks") =>
  async (req: Request, res: Response) => {
    try {
      res.json({
        success: true,
        data: await managerOperations(
          req.user!,
          operationsQuery.parse(req.query),
          kind,
        ),
      });
    } catch (e) {
      if (e instanceof z.ZodError)
        throw new ApiError(400, "Invalid daily filters", e.issues);
      throw e;
    }
  };
