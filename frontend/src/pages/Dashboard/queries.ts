import { useQuery } from "@tanstack/react-query";
import { getLocationsWithCounts } from "./api";

export const useGetDashboardLocations = () => {
  return useQuery({
    queryKey: ["dashboard-locations"],
    queryFn: getLocationsWithCounts,
    staleTime: 2 * 60 * 1000,
  });
};
