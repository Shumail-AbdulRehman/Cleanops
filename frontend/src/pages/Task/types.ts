import type { Weekday } from "@/lib/workDays";

export type CreateTaskInput = {
  title: string;
  description?: string;
  locationId: number;
  staffId?: number;
  shiftStart: Date;
  shiftEnd: Date;
  recurringType?: "DAILY" | "ONCE";
  effectiveDate: Date;
  recurringEndDate?: Date;
};

export type CreateTaskTemplateFormData = CreateTaskInput & {
  repeatDays?: Weekday[];
  areaId: number;
  inventorySelection: "ALL" | "SUBSET";
  selectedItems: Array<{areaItemId: number; mandatory: boolean}>;
  expectedInventoryVersion: number;
  sourceLegacyTemplateId?: number;
};


export type EditTaskInput = {
  title?: string;
  description?: string;
  locationId?: number;
  shiftStart?: Date;
  shiftEnd?: Date;
  recurringType?: "DAILY" | "ONCE";
  effectiveDate?: Date;
  recurringEndDate?: Date;
};

export type AreaMatchStatus = "passed" | "flagged" | "blocked";

export type AreaSubmissionAttempt = {
  photoUrl: string;
  areaMatchStatus: AreaMatchStatus | null;
  similarityScore: number | null;
  at: string;
};

export type AreaSubmission = {
  id: number;
  taskInstanceId: number;
  referenceImageId: number;
  staffId: number;
  photoUrl: string | null;
  scannedAt: string | null;
  uploadedAt: string | null;
  status: "APPROVED" | "BLOCKED" | "CV_ERROR" | "PENDING" | "REJECTED_TIMEOUT";
  similarityScore: number | null;
  areaMatchStatus: AreaMatchStatus | null;
  areaMatchFlag: boolean;
  bestReferenceImageId: number | null;
  colorScore: number | null;
  ssimScore: number | null;
  featureScore: number | null;
  attempts: AreaSubmissionAttempt[];
  referenceImage: { id: number; name: string; imageUrl: string } | null;
  staff: { id: number; name: string } | null;
};
