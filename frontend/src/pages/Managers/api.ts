import { client } from "../../api/client.js";
import type { CreateManagerInput, UpdateManagerInput } from "./types.js";

export const getManagers = async () => {
  const res = await client.get("/manager/");
  return res.data;
};

export const createManager = async (data: CreateManagerInput) => {
  const res = await client.post("/manager/", data);
  return res.data;
};

export const updateManager = async (id: number, data: UpdateManagerInput) => {
  const res = await client.patch(`/manager/${id}`, data);
  return res.data;
};

export const deleteManager = async (id: number) => {
  const res = await client.delete(`/manager/${id}`);
  return res.data;
};
