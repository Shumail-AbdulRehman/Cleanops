import { client } from "@/api/client";

export const assignStaffToLocation = async (staffId: number, locationId: number) => {
  const res = await client.patch(`/assignment/staff/${staffId}/location/${locationId}`);
  return res.data;
};

export const assignStaffToTaskTemplate = async (templateId: number, staffId: number) => {
  const res = await client.patch(`/assignment/task-template/${templateId}/staff/${staffId}`);
  return res.data;
};
