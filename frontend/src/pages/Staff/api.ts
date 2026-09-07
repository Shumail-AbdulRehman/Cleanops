import { client } from "@/api/client";
import type { Weekday } from "@/lib/workDays";

export { assignStaffToLocation } from "../Assignment/api";

export interface CreateStaffInput {
  name: string;
  email?: string;
  phone: string;
  locationId?: number;
  shiftStart?: string;
  shiftEnd?: string;
  workDays?: Weekday[];
}

export interface EditStaffInput {
  name?: string;
  email?: string | null;
  phone?: string;
  shiftStart?: string;
  shiftEnd?: string;
  workDays?: Weekday[];
}

export const getStaff = async () => {
  const res = await client.get("/staff/");
  return res.data;
};

export interface StaffDetailsFilters {
  month?: string;
  dateFrom?: string;
  dateTo?: string;
}

export const getStaffDetails = async (
  id: number,
  filters?: StaffDetailsFilters,
) => {
  const params: Record<string, string> = {};

  if (filters?.month) params.month = filters.month;
  if (filters?.dateFrom) params.dateFrom = filters.dateFrom;
  if (filters?.dateTo) params.dateTo = filters.dateTo;

  const res = await client.get(`/staff/details/${id}`, { params });
  return res.data;
};

export const createStaff = async (data: CreateStaffInput) => {
  const res = await client.post("/staff/create-staff", data);
  return res.data;
};

export const deleteStaff = async (id: number) => {
  const res = await client.delete(`/staff/${id}`);
  return res.data;
};

export const editStaff = async (id: number, data: EditStaffInput) => {
  const res = await client.patch(`/staff/${id}`, data);
  return res.data;
};
