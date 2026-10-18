import { test } from "node:test";
import assert from "node:assert/strict";
import { notificationDestination } from "../notifications/model";
import { stackRoutes, tabRoutes } from "./routeNames";

test("tab names that notifications open stay unchanged", () => {
  assert.equal(tabRoutes.myDay, "Shift");
  assert.equal(tabRoutes.tasks, "Tasks");
  assert.equal(tabRoutes.history, "History");
  assert.equal(tabRoutes.profile, "Profile");
});

test("stack routes name every redesign screen", () => {
  assert.deepEqual(stackRoutes, {
    login: "Login",
    staffTabs: "StaffTabs",
    taskDetail: "TaskDetail",
    startTask: "StartTask",
    verification: "Verification",
    helpGuide: "HelpGuide",
    taskAlerts: "TaskAlerts",
    historyTask: "HistoryTask",
  });
});

test("every route value is unique across tabs and stack", () => {
  const values = [...Object.values(tabRoutes), ...Object.values(stackRoutes)];
  assert.equal(new Set(values).size, values.length);
});

test("notification destinations match the checked tab names", () => {
  assert.equal(notificationDestination("TASK_ASSIGNED"), tabRoutes.tasks);
  assert.equal(notificationDestination("TASK_CHANGED"), tabRoutes.tasks);
  assert.equal(notificationDestination(undefined), tabRoutes.myDay);
  assert.equal(notificationDestination("SHIFT_APPROACHING"), tabRoutes.myDay);
});
