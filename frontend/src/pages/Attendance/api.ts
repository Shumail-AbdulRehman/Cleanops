import { client } from "@/api/client";

export interface AttendanceFilters {
  locationId?: number;
  staffId?: number;
  from?: string;
  to?: string;
}

export const getStaffAttendance = async (filters?: AttendanceFilters) => {
  const params: Record<string, string | number> = {};
  if (filters?.locationId) params.locationId = filters.locationId;
  if (filters?.staffId) params.staffId = filters.staffId;
  if (filters?.from) params.from = filters.from;
  if (filters?.to) params.to = filters.to;

  const res = await client.get("/attendance/", { params });
  return res.data;
};
