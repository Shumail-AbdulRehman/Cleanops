import { test } from "node:test";
import assert from "node:assert/strict";
import {
  everydayActions,
  reviewGuidance,
  reviewHeading,
} from "../src/pages/Exceptions/reviewPresentation.ts";
import { issueActions } from "../src/pages/Exceptions/actionPresentation.ts";
test("missing evidence directs managers to requirements without implying resolution replaces photos", () => {
  const issue = {
    reasonCode: "MISSING_EVIDENCE",
    allowedActions: ["RESOLVE_ISSUE"],
  };
  assert.equal(reviewHeading(issue), "Required photos are missing");
  assert.match(
    reviewGuidance(issue),
    /Resolve the review with a note/,
  );
  assert.deepEqual(
    issueActions({ allowedActions: [] }, issue).filter((a) =>
      everydayActions.includes(a),
    ),
    ['RESOLVE_ISSUE'],
  );
});
test("checking service failure is distinct from cleaning failure", () => {
  assert.match(
    reviewGuidance({ reasonCode: "SERVICE_FAILURE" }),
    /does not mean the area is dirty/,
  );
});
