import { useQuery } from "@tanstack/react-query";
import { getStaffAttendance, type AttendanceFilters } from "./api";

export const useGetAttendance = (filters?: AttendanceFilters) => {
  return useQuery({
    queryKey: ["attendance", filters ?? null],
    queryFn: () => getStaffAttendance(filters),
    staleTime: 2 * 60 * 1000,
  });
};
