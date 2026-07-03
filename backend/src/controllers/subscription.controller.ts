import { createBillingPortal } from "../services/billingLifecycle.service.js";
import { Request, Response } from "express";
import { ApiResponse } from "../utils/ApiResponse.js";
import { getCompanySubscriptionSummary } from "../services/subscription.service.js";
import { getPublicBillingCatalog } from "../services/billingCatalog.service.js";

const countryHeaders = [
  "x-vercel-ip-country",
  "cf-ipcountry",
  "x-country-code",
] as const;

const readCountryHeader = (req: Request) => {
  for (const header of countryHeaders) {
    const rawValue = req.headers[header];
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    const normalized = value?.trim().toUpperCase();

    if (normalized && /^[A-Z]{2}$/.test(normalized) && normalized !== "XX") {
      return normalized;
    }
  }

  return undefined;
};

export const getPricingContext = (req: Request, res: Response) => {
  const countryCode = readCountryHeader(req);

  res.setHeader("Cache-Control", "private, no-store");
  countryHeaders.forEach((header) => res.vary(header));
  res.status(200).json(
    new ApiResponse(
      200,
      countryCode ? { countryCode } : {},
      "Pricing context fetched successfully"
    )
  );
};

export const getSubscription = async (req: Request, res: Response) => {
  const summary = await getCompanySubscriptionSummary(req.user!.companyId);
  res.status(200).json(new ApiResponse(200, summary, "Subscription fetched successfully"));
};

export const getPublicPlanPrices = async (_req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const prices = await getPublicBillingCatalog();
  res.status(200).json(new ApiResponse(200, prices, "Plan prices fetched successfully"));
};

export const createCustomerPortalSession = async (req: Request, res: Response) => {
  const result = await createBillingPortal(req.user!, req.body);
  res.setHeader("Cache-Control", "private, no-store");
  res.status(201).json(new ApiResponse(201, result, "Customer portal session created successfully"));
};
