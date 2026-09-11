import { client } from "@/api/client";
import type { CreateTaskTemplateFormData } from "./types";
export type { CreateTaskTemplateFormData, AreaSubmission } from "./types";

export const createTaskTemplate = async (data: CreateTaskTemplateFormData) => {
  const res = await client.post("/task-template", data);
  return res.data;
};

export const getTaskTemplate = async (id: number) => {
  const res = await client.get(`/task-template/${id}`);
  return res.data;
};

export interface EditTaskTemplateInput {
  areaId?: number;
  inventorySelection?: "ALL" | "SUBSET";
  selectedItems?: Array<{areaItemId:number; mandatory:boolean}>;
  expectedInventoryVersion?: number;
  isActive?: boolean;
  title?: string;
  description?: string;
  locationId?: number;
  shiftStart?: string;
  shiftEnd?: string;
  recurringType?: "DAILY" | "ONCE";
  effectiveDate?: string;
  recurringEndDate?: string;
}

export const editTaskTemplate = async (
  id: number,
  data: EditTaskTemplateInput,
) => {
  const res = await client.patch(`/task-template/${id}`, data);
  return res.data;
};

export const deleteTaskTemplate = async (id: number) => {
  const res = await client.delete(`/task-template/${id}`);
  return res.data;
};

export const getAreaSubmissions = async (taskId: number) => {
  const res = await client.get(`/task-instance/${taskId}/area-submissions`);
  return res.data;
};
