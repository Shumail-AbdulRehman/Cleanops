import { prisma } from "../prisma/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { companyHasPaidAccess } from "./paddleFulfillment.service.js";

export type PlanCode = "STARTER" | "PRO" | "ADVANCED";
export type PlanFeature =
  | "managerAccess"
  | "automaticAssignment"
  | "automaticReassignment"
  | "inventoryVerification";
export type LimitedResource = "locations" | "staff" | "managers";

type PlanDefinition = {
  code: PlanCode;
  name: string;
  description: string;
  limits: {
    locations: number;
    staff: number;
    managers: number;
  };
  features: Record<PlanFeature, boolean>;
  featureLabels: string[];
};

export const PLAN_DEFINITIONS: Record<PlanCode, PlanDefinition> = {
  STARTER: {
    code: "STARTER",
    name: "Starter",
    description: "For individuals and very small cleaning teams.",
    limits: { locations: 1, staff: 3, managers: 1 },
    features: {
      managerAccess: false,
      automaticAssignment: false,
      automaticReassignment: false,
      inventoryVerification: true,
    },
    featureLabels: [
      "GPS attendance and selfies",
      "Daily and one-time tasks",
      "Area QR and guided native capture",
      "Inventory verification and exception review",
      "Core operational dashboard",
    ],
  },
  PRO: {
    code: "PRO",
    name: "Pro",
    description: "For small cleaning companies managing multiple teams.",
    limits: { locations: 5, staff: 25, managers: 3 },
    features: {
      managerAccess: true,
      automaticAssignment: true,
      automaticReassignment: true,
      inventoryVerification: true,
    },
    featureLabels: [
      "Everything in Starter",
      "Manager location access",
      "Automatic assignment and reassignment",
      "Inventory verification on every plan",
      "Protected evidence and decision history",
      "Staff and location performance views",
    ],
  },
  ADVANCED: {
    code: "ADVANCED",
    name: "Enterprise",
    description: "For larger cleaning operations with more locations and staff.",
    limits: { locations: 20, staff: 200, managers: 20 },
    features: {
      managerAccess: true,
      automaticAssignment: true,
      automaticReassignment: true,
      inventoryVerification: true,
    },
    featureLabels: [
      "Everything in Pro",
      "Inventory verification on every plan",
      "Higher location, staff, and manager limits",
      "Protected evidence and decision history",
      "Assignment and reassignment history",
      "Multi-timezone and overnight-shift support",
    ],
  },
};

const resourceLabels: Record<LimitedResource, string> = {
  locations: "locations",
  staff: "staff members",
  managers: "manager accounts (including the company admin)",
};

export const getCompanyPlan = async (companyId: number) => {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      plan: true,
      subscriptionStatus: true,
      planUpdatedAt: true,
      billingCustomerId: true,
      billingSubscriptionId: true,
    },
  });

  if (!company) throw new ApiError(404, "Company not found");

  return {
    company,
    definition: PLAN_DEFINITIONS[company.plan],
  };
};

export const getCompanySubscriptionSummary = async (companyId: number) => {
  const [{ company, definition }, locations, staff, managers] = await Promise.all([
    getCompanyPlan(companyId),
    prisma.location.count({ where: { companyId, isActive: true } }),
    prisma.staff.count({ where: { companyId, isActive: true } }),
    prisma.manager.count({ where: { companyId, isActive: true } }),
  ]);

  return {
    company,
    plan: definition,
    usage: { locations, staff, managers },
    availablePlans: Object.values(PLAN_DEFINITIONS),
  };
};

export const assertCompanyCanAdd = async (
  companyId: number,
  resource: LimitedResource
) => {
  const { company, definition } = await getCompanyPlan(companyId);

  const hasAccess = await companyHasPaidAccess(companyId);
  if (!hasAccess) {
    throw new ApiError(403, "Your subscription is not active. Contact your company administrator.");
  }

  const current = resource === "locations"
    ? await prisma.location.count({ where: { companyId, isActive: true } })
    : resource === "staff"
      ? await prisma.staff.count({ where: { companyId, isActive: true } })
      : await prisma.manager.count({ where: { companyId, isActive: true } });
  const limit = definition.limits[resource];

  if (current >= limit) {
    throw new ApiError(
      403,
      `${definition.name} allows up to ${limit} ${resourceLabels[resource]}. Upgrade your plan to add more.`
    );
  }
};

export const companyHasFeature = async (companyId: number, feature: PlanFeature) => {
  const { company, definition } = await getCompanyPlan(companyId);
  const hasAccess = await companyHasPaidAccess(companyId);
  return hasAccess && definition.features[feature];
};
