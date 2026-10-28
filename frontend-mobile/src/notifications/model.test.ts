import test from "node:test";
import assert from "node:assert/strict";
import {
  notificationTarget,
  belongsToAccount,
  notificationDestination,
  notificationKinds,
} from "./model.ts";
test("rejects malformed or cross-account push payloads and uses safe destinations", () => {
  for (const value of [
    null,
    {},
    { notificationId: -1, staffId: 2, companyId: 1 },
    { notificationId: 1, staffId: "2", companyId: 1 },
    { notificationId: 1.2, staffId: 2, companyId: 1 },
  ])
    assert.equal(notificationTarget(value), null);
  const target = notificationTarget({
    notificationId: 1,
    staffId: 2,
    companyId: 1,
    url: "https://untrusted.invalid",
    kind: "TASK_ASSIGNED",
  })!;
  assert.equal(belongsToAccount(target, { id: 2, companyId: 1 }), true);
  assert.equal(belongsToAccount(target, { id: 3, companyId: 1 }), false);
  assert.equal(belongsToAccount(target, { id: 2, companyId: 8 }), false);
  assert.equal(belongsToAccount(target, null), false);
  assert.equal(notificationDestination("TASK_ASSIGNED"), "Tasks");
  assert.equal(notificationDestination("CHECKOUT_APPROACHING"), "Shift");
  assert.equal(notificationDestination(target.kind), "Tasks");
  assert.equal(notificationTarget({ ...target, kind: "untrusted" })?.kind, undefined);
  assert.equal(notificationDestination(undefined), "Shift");
});
test("the notification event list excludes reviews and shift/location changes", () => {
  assert.deepEqual(notificationKinds, [
    "TASK_ASSIGNED",
    "TASK_CHANGED",
    "SHIFT_APPROACHING",
    "MISSING_CHECK_IN",
    "CHECKOUT_APPROACHING",
  ]);
});
