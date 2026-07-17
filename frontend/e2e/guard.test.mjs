import { test } from "node:test";
import assert from "node:assert/strict";
import { isolatedBootstrap } from "./guard.mjs";
test("E2E accepts only an explicit disposable local bootstrap", () => {
  assert.equal(
    isolatedBootstrap(
      "postgresql://fixture@127.0.0.1:56442/priv_e2e_test",
      "test",
    ).pathname,
    "/priv_e2e_test",
  );
});
for (const raw of [
  undefined,
  "postgresql://fixture@remote.invalid/priv_e2e_test",
  "postgresql://fixture@127.0.0.1/customer",
  "postgresql://fixture@127.0.0.1/customer_test",
  "postgresql://fixture@127.0.0.1/priv_e2e_test?host=remote.invalid",
  "postgresql://fixture@127.0.0.1:5432/priv_e2e_test",
  "postgresql://fixture@localhost:56442/priv_e2e_test",
  "postgresql://another@127.0.0.1:56442/priv_e2e_test",
  "postgresql://fixture:synthetic@127.0.0.1:56442/priv_e2e_test",
])
  test(
    "E2E rejects an absent/unsafe bootstrap without leaking connection material: " +
      String(raw === undefined ? "missing" : new URL(raw).pathname),
    () => assert.throws(() => isolatedBootstrap(raw, "test")),
  );
test("production cannot invoke disposable E2E setup", () =>
  assert.throws(() =>
    isolatedBootstrap(
      "postgresql://fixture@127.0.0.1/priv_e2e_test",
      "production",
    ),
  ));
