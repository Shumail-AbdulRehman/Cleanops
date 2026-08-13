import {client} from "../../api/client.js"
import type{ LoginForm } from "./types.js";
import type{ AuthUser } from "./types.js";

export const login = async (data: LoginForm): Promise<AuthUser> => {
  const payload = { email: data.email, password: data.password };
  const res = await client.post('/common/login', payload, { withCredentials: true });
  return res.data.data;
};
