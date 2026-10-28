import test from "node:test";
import assert from "node:assert/strict";
import type * as Notifications from "expo-notifications";
import { configureAndroidAlertChannels, configureStaffAlertActions, staffAlertEvents } from "./channels.ts";

test("an existing install gets new heads-up channels without deleting old settings", async () => {
  const saved = new Map<string, { importance: number; sound?: string | null; enableVibrate?: boolean; name: string }>([
    ["tasks", { importance: 5, name: "Cleaning tasks" }],
    ["attendance", { importance: 5, name: "Attendance reminders" }],
  ]);
  const api = {
    AndroidImportance: { HIGH: 6 },
    AndroidNotificationVisibility: { PRIVATE: 2 },
    setNotificationChannelAsync: async (id: string, input: { importance: number; name: string }) => {
      // Android preserves the original importance on an existing channel.
      saved.set(id, { ...input, importance: saved.get(id)?.importance ?? input.importance });
    },
  } as unknown as Pick<typeof Notifications,
    "setNotificationChannelAsync" | "AndroidImportance" | "AndroidNotificationVisibility">;
  await configureAndroidAlertChannels(api);
  assert.equal(saved.get("tasks")?.importance, 5);
  assert.equal(saved.get("attendance")?.importance, 5);
  for (const id of staffAlertEvents.map(event => event.id)) {
    assert.equal(saved.get(id)?.importance, 6);
    assert.equal(saved.get(id)?.sound, "default");
    assert.equal(saved.get(id)?.enableVibrate, true);
  }
  // A later user choice must survive subsequent registration and language changes.
  saved.get("staff-task-assigned-v3")!.importance = 3;
  await configureAndroidAlertChannels(api, "ur");
  assert.equal(saved.get("staff-task-assigned-v3")?.importance, 3);
  assert.equal(saved.get("staff-checkout-approaching-v3")?.name, "روانگی کی یاد دہانی");
});

test("each event has a distinct vibration and an action that opens the app", async () => {
  assert.equal(new Set(staffAlertEvents.map(event => JSON.stringify(event.vibration))).size, 5);
  const categories: Array<{ id: string; title: string; opens: boolean }> = [];
  await configureStaffAlertActions({ setNotificationCategoryAsync: async (id, actions) => {
    categories.push({ id, title: actions[0]!.buttonTitle, opens: actions[0]!.options?.opensAppToForeground === true });
    return { identifier: id, actions };
  } });
  assert.equal(categories.length, 5);
  assert.ok(categories.every(category => category.opens));
  assert.ok(categories.every(category => !/[:-]/.test(category.id)));
  assert.ok(categories.some(category => category.title === "Check in"));
  assert.ok(categories.some(category => category.title === "Check out"));
});
