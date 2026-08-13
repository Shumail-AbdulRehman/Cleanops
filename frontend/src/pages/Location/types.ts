import type { Weekday } from "@/lib/workDays";

export type CreateLocationInput = {
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  timezone?: string;
  radiusMeters?: number;
};


export type LocationFormValues = {
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  timezone: string;
  radiusMeters: number;
};

export type LocationWithCounts = {
  id: number;
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  timezone: string;
  radiusMeters: number;
  isActive: boolean;
  status: string; 
  _count: {
    staff: number;
    taskTemplates: number;
  };
};


export interface LocationStaff {
  id: number;
  name: string;
  email: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  workDays?: Weekday[];
  isActive: boolean;
}

export interface ReferenceImage {
  id: number;
  name: string;
  imageUrl: string;
  sortOrder: number;
}

export interface TaskTemplate {
  verificationVersion?: number;
  areaId?: number | null;
  area?: {id:number; name:string} | null;
  inventorySelection?: 'ALL' | 'SUBSET';
  setupStatus?: string;
  id: number;
  title: string;
  description?: string | null;
  staffId?: number | null;
  staff?: { name: string } | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  recurringType?: "DAILY" | "ONCE";
  repeatDays?: Weekday[];
  effectiveDate?: string | null;
  recurringEndDate?: string | null;
  isActive?: boolean;
  qrToken?: string | null;
  referenceImageUrl?: string | null;
  referenceImages?: ReferenceImage[];
}
