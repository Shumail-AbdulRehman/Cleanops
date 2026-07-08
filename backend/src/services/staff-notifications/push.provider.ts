import { z } from "zod";
export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: "default";
  channelId: string;
  priority: "high";
  subtitle: string;
  categoryId: string;
  ttl: number;
};
export type PushResult = {
  status: "ok" | "error";
  id?: string;
  details?: { error?: string };
};
const resultSchema = z.object({
  status: z.enum(["ok", "error"]),
  id: z.string().min(1).optional(),
  details: z.object({ error: z.string().optional() }).optional(),
});
export interface StaffPushProvider {
  send(messages: PushMessage[]): Promise<PushResult[]>;
  receipts(ids: string[]): Promise<Record<string, PushResult>>;
}
export class ExpoStaffPushProvider implements StaffPushProvider {
  async request(path: string, body: unknown) {
    const token = process.env.EXPO_PUSH_ACCESS_TOKEN;
    const res = await fetch(`https://exp.host/--/api/v2/push/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`EXPO_HTTP_${res.status}`);
    const value = (await res.json()) as { data?: unknown; errors?: unknown };
    if (
      (Array.isArray(value.errors)
        ? value.errors.length > 0
        : !!value.errors) ||
      !value.data
    )
      throw new Error("EXPO_INVALID_RESPONSE");
    return value.data;
  }
  async send(messages: PushMessage[]) {
    const result = await this.request("send", messages);
    const parsed = z.array(resultSchema).safeParse(result);
    if (!parsed.success || parsed.data.length !== messages.length)
      throw new Error("EXPO_INVALID_RESPONSE");
    return parsed.data;
  }
  async receipts(ids: string[]) {
    const result = await this.request("getReceipts", { ids });
    const parsed = z.record(z.string(), resultSchema).safeParse(result);
    if (!parsed.success) throw new Error("EXPO_INVALID_RESPONSE");
    return parsed.data;
  }
}
