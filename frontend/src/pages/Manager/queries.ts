import { useQuery } from "@tanstack/react-query";

import { getTodayStatus, type TodayStatusFilters } from "./api";

export const useGetTodayStatus = (filters?: TodayStatusFilters) => {
  return useQuery({
    queryKey: ["manager", "today-status", filters ?? null],
    queryFn: () => getTodayStatus(filters),
    staleTime: 30 * 1000,
  });
};
