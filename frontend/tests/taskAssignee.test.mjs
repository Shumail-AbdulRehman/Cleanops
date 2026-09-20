import test from "node:test";
import assert from "node:assert/strict";
import {
  taskAssignee,
  assignmentLabel,
} from "../src/pages/Task/taskAssignee.ts";

const previous = {
  id: 1,
  staffId: 67,
  status: "MISSED",
  isCurrent: false,
  staff: { id: 67, name: "Previous worker" },
};

test("a cleared current worker retains a clearly historical missed assignee", () => {
  const result = taskAssignee({
    staffId: null,
    staff: null,
    assignments: [previous],
  });
  assert.equal(result.worker.name, "Previous worker");
  assert.equal(result.previous, true);
  assert.equal(assignmentLabel(result.assignment.status), "Missed assignment");
});
test("a genuinely unassigned task has no worker or historical label", () => {
  assert.deepEqual(taskAssignee({ staffId: null, assignments: [] }), {
    worker: null,
    previous: false,
    assignment: undefined,
  });
});
test("a replacement takes precedence over historical workers and unrelated stale records", () => {
  const replacement = {
    id: 2,
    staffId: 68,
    status: "ASSIGNED",
    isCurrent: true,
    staff: { id: 68, name: "Replacement" },
  };
  const result = taskAssignee({
    staffId: 68,
    staff: previous.staff,
    assignments: [previous, replacement],
  });
  assert.equal(result.worker.name, "Replacement");
  assert.equal(result.previous, false);
});
test("closed completed assignments retain the worker recorded on the task", () => {
  const result = taskAssignee({
    staffId: 67,
    staff: previous.staff,
    assignments: [{ ...previous, status: "COMPLETED" }],
  });
  assert.equal(result.worker.name, "Previous worker");
  assert.equal(result.previous, false);
});
test("latest assignment uses timestamps and deterministic ID ties across response orderings", () => {
  const old = { ...previous, id: 30, assignedAt: "2026-10-13T08:00:00Z" };
  const latest = {
    ...previous,
    id: 20,
    assignedAt: "2026-10-14T08:00:00Z",
    staff: { name: "Latest worker" },
  };
  const tie = { ...latest, id: 21, staff: { name: "Latest tie" } };
  for (const assignments of [
    [tie, old, latest],
    [old, latest, tie],
  ]) {
    const result = taskAssignee({ staffId: null, assignments });
    assert.equal(result.worker.name, "Latest tie");
    assert.equal(result.previous, true);
  }
});
