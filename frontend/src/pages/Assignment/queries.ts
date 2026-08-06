import { useMutation, useQueryClient } from "@tanstack/react-query";
import { assignStaffToLocation, assignStaffToTaskTemplate } from "./api";

export const useAssignStaffToLocation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ staffId, locationId }: { staffId: number; locationId: number }) =>
      assignStaffToLocation(staffId, locationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["location"] });
      qc.invalidateQueries({ queryKey: ["task"] });
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({ queryKey: ["operations"] });
    },
  });
};

export const useAssignStaffToTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, staffId }: { templateId: number; staffId: number }) =>
      assignStaffToTaskTemplate(templateId, staffId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["location"] });
      qc.invalidateQueries({ queryKey: ["task"] });
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({ queryKey: ["operations"] });
    },
  });
};
