import { deleteLocation } from "./api";
import { invalidateWorkspace } from "@/lib/invalidateWorkspace";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getLocations,
  createLocation,
  getLocationById,
  getLocationSchedule,
  updateLocation,
} from "./api";
import type { LocationStatsFilter } from "./api";

export const useGetLocations = (includeInactive = false) => {
  return useQuery({
    queryKey: ["getLocations", { includeInactive }],
    queryFn: ({ signal }) => getLocations(includeInactive, signal),
  });
};

export const useCreateLocation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createLocation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["getLocations"] });
      void invalidateWorkspace(queryClient);
    },
  });
};

export const useUpdateLocation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateLocation,
    onSuccess: () => invalidateWorkspace(queryClient),
  });
};

export const useGetLocationById = (
  id: string,
  filter?: LocationStatsFilter,
) => {
  return useQuery({
    queryKey: ["location", id, filter ?? null],
    queryFn: () => getLocationById(id, filter),
    enabled: !!id,
  });
};

export type { LocationStatsFilter };
export const useDeleteLocation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: deleteLocation,
    onSuccess: () => invalidateWorkspace(client),
  });
};

export const useLocationSchedule = (
  companyId: number | undefined,
  id: string,
  week?: string,
) =>
  useQuery({
    queryKey: ["location", "schedule", companyId, id, week ?? "current"],
    queryFn: ({ signal }) => getLocationSchedule(id, week, signal),
    enabled: !!companyId && !!id,
  });
