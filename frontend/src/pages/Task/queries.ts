import { invalidateWorkspace } from "@/lib/invalidateWorkspace";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTaskTemplate,
  editTaskTemplate,
  deleteTaskTemplate,
  getAreaSubmissions,
  type CreateTaskTemplateFormData,
  type EditTaskTemplateInput,
} from "./api";

export const useGetAreaSubmissions = (taskId: number, enabled = true) => {
  return useQuery({
    queryKey: ["area-submissions", taskId],
    queryFn: () => getAreaSubmissions(taskId),
    enabled: enabled && !!taskId,
  });
};

export const useCreateTaskTemplate = (autoInvalidate = true) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTaskTemplateFormData) => createTaskTemplate(data),
    onSuccess: () => {
      if (autoInvalidate) {
        qc.invalidateQueries({ queryKey: ["location"] });
        qc.invalidateQueries({ queryKey: ["operations"] });
      }
    },
  });
};

export const useEditTaskTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: EditTaskTemplateInput }) =>
      editTaskTemplate(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["location"] });
      qc.invalidateQueries({ queryKey: ["operations"] });
    },
  });
};

export const useDeleteTaskTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteTaskTemplate(id),
    onSuccess: () => {
      return invalidateWorkspace(qc);
    },
  });
};
