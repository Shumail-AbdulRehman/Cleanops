import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getStaff,
  getStaffDetails,
  createStaff,
  deactivateStaff,
  assignShift,
  editStaff,
  type StaffDetailsFilters,
  type CreateStaffInput,
  type AssignShiftInput,
  type EditStaffInput,
} from "./api";

export const useGetStaff = () => {
  return useQuery({
    queryKey: ["staff"],
    queryFn: getStaff,
    staleTime: 2 * 60 * 1000,
  });
};

export const getStaffDetailsQueryOptions = (
  id: number,
  filters?: StaffDetailsFilters
) => ({
  queryKey: ["staff", "details", id, filters ?? null] as const,
  queryFn: () => getStaffDetails(id, filters),
  enabled: !!id,
  staleTime: 2 * 60 * 1000,
});

export const useGetStaffDetails = (id: number, filters?: StaffDetailsFilters) => {
  return useQuery(getStaffDetailsQueryOptions(id, filters));
};

export const useCreateStaff = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateStaffInput) => createStaff(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });
};

export const useDeactivateStaff = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deactivateStaff(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });
};

export const useAssignShift = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: AssignShiftInput }) =>
      assignShift(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });
};

export const useEditStaff = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: EditStaffInput }) =>
      editStaff(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({ queryKey: ["location"] });
    },
  });
};
