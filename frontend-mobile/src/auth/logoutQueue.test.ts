import test from "node:test";
import assert from "node:assert/strict";
import { createLogoutQueue } from "./logoutQueue.ts";
test("retains offline logout revocations across restart and removes only confirmed requests", async () => {
  let saved: string | null = null,
    online = false;
  const sent: unknown[] = [];
  const store = {
    read: async () => saved,
    write: async (v: string | null) => {
      saved = v;
    },
  };
  const post = async (entry: unknown) => {
    if (!online) throw new Error("offline");
    sent.push(entry);
  };
  const queue = createLogoutQueue(store, post),
    entry = {
      server: "https://example.test/api",
      refreshToken: "test-only-token",
    };
  await queue.enqueue(entry);
  await queue.enqueue(entry);
  await queue.flush();
  assert.equal(JSON.parse(saved!).length, 1);
  assert.equal(sent.length, 0);
  online = true;
  const reopened = createLogoutQueue(store, post);
  await Promise.all([reopened.flush(), reopened.flush()]);
  assert.deepEqual(sent, [entry]);
  assert.equal(saved, null);
});
