export type BillingPeriod = "month" | "year";

export interface Tier {
  name: "Starter" | "Pro";
  description: string;
  features: string[];
  capacity: string[];
  priceId: Record<BillingPeriod, string>;
  recommended?: boolean;
}

export const TIERS: Tier[] = [
  {
    name: "Starter",
    description: "For individuals and very small cleaning teams.",
    capacity: ["1 location", "3 staff", "1 manager seat"],
    features: [
      "GPS attendance and selfies",
      "Daily and one-time tasks",
      "Area QR and guided native capture",
      "Inventory verification and exception review",
      "Core operational dashboard",
    ],
    priceId: {
      month: "pri_01m26dxq2nvjb2ak7jt4gym22g",
      year: "pri_01m26dxqw2hx8kk0tc70wg5t29",
    },
  },
  {
    name: "Pro",
    description: "For cleaning companies managing multiple teams.",
    capacity: ["5 locations", "25 staff", "3 manager seats"],
    features: [
      "Everything in Starter",
      "Manager location access",
      "Automatic assignment and reassignment",
      "Inventory verification on every plan",
      "Protected evidence and decision history",
      "Staff and location performance views",
    ],
    priceId: {
      month: "pri_01m26dxtv0k73yk444nc0vvqjj",
      year: "pri_01m26dxvj8cmtdtr7a660mqa2h",
    },
    recommended: true,
  },
];

export const PLAN_COMPARISON: { name: string; values: (string | boolean)[] }[] = [
  { name: "Locations", values: ["1", "5", "Discuss your needs"] },
  { name: "Staff members", values: ["3", "25", "Discuss your needs"] },
  { name: "Manager seats, including your admin", values: ["1", "3", "Discuss your needs"] },
  { name: "GPS attendance & selfies", values: [true, true, true] },
  { name: "Daily & one-time tasks", values: [true, true, true] },
  { name: "Area QR & guided native capture", values: [true, true, true] },
  { name: "Inventory verification", values: [true, true, true] },
  { name: "Protected evidence & exception review", values: [true, true, true] },
  { name: "Manager location access", values: [false, true, true] },
  { name: "Automatic assignment & reassignment", values: [false, true, true] },
  { name: "Staff and location performance views", values: [false, true, true] },
];
