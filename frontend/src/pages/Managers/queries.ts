import { deleteManager } from "./api";
import { invalidateWorkspace } from "@/lib/invalidateWorkspace";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getManagers, createManager, updateManager } from "./api";
import type { CreateManagerInput, UpdateManagerInput } from "./types";

export const useGetManagers = () => {
  return useQuery({
    queryKey: ["getManagers"],
    queryFn: getManagers,
  });
};

export const useCreateManager = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateManagerInput) => createManager(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["getManagers"] });
    },
  });
};

export const useUpdateManager = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateManagerInput }) =>
      updateManager(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["getManagers"] });
    },
  });
};

export const useDeleteManager = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: deleteManager,
    onSuccess: () => invalidateWorkspace(client),
  });
};
