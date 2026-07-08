import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpoStaffPushProvider } from "./push.provider.js";
afterEach(() => vi.unstubAllGlobals());
const messages = [
  {
    to: "ExpoPushToken[test-only]",
    title: "Test",
    body: "Test",
    sound: "default" as const,
    channelId: "staff-task-assigned-v3",
    categoryId: "staff_task_assigned_v3",
    priority: "high" as const,
    subtitle: "Cleaning tasks",
    ttl: 60,
    data: { notificationId: 1 },
  },
];
describe("Expo push transport validation", () => {
  it("accepts opaque ticket identifiers and provider receipts, including empty error arrays", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: [{ status: "ok", id: "opaque-receipt-id" }],
              errors: [],
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ data: { "opaque-receipt-id": { status: "ok" } } }),
          ),
        ),
    );
    const provider = new ExpoStaffPushProvider();
    expect((await provider.send(messages))[0]!.id).toBe("opaque-receipt-id");
    const request = vi.mocked(fetch).mock.calls[0]![1]!;
    expect(JSON.parse(request.body as string)[0]).toMatchObject({
      priority: "high", channelId: "staff-task-assigned-v3", sound: "default",
      categoryId: "staff_task_assigned_v3",
      subtitle: "Cleaning tasks",
    });
    expect(
      (await provider.receipts(["opaque-receipt-id"]))["opaque-receipt-id"]!
        .status,
    ).toBe("ok");
  });
  it("rejects HTTP failures and malformed or incomplete ticket batches", async () => {
    const provider = new ExpoStaffPushProvider();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 429 })),
    );
    await expect(provider.send(messages)).rejects.toThrow("EXPO_HTTP_429");
    for (const data of [[], [null], [{ status: "unknown" }]]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(JSON.stringify({ data }))),
      );
      await expect(provider.send(messages)).rejects.toThrow(
        "EXPO_INVALID_RESPONSE",
      );
    }
  });
});
