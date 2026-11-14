import assert from "node:assert/strict";
import test from "node:test";
import { photoFeedback, requiredPhotoIds, photoCorrection } from "./feedback";
import { translate } from "../i18n/translations";
import type { Manifest } from "./types";

test("delivery, checks, cleaning and review have distinct staff guidance", () => {
  assert.equal(photoFeedback("SAVED").label, "Upload this photo again");
  assert.equal(photoFeedback("RETRY_WAIT").label, photoFeedback("SAVED").label);
  assert.equal(photoFeedback("UPLOADING").label, "Photo uploading");
  assert.equal(
    photoFeedback("SERVER_ACCEPTED").label,
    "Photo received and being checked",
  );
  assert.equal(photoFeedback("SERVICE_FAILURE").kind, "review");
  assert.equal(
    photoFeedback("SERVICE_FAILURE").label.includes("cleaning"),
    false,
  );
  assert.equal(photoFeedback("RECAPTURE_REQUIRED").label, "Take another photo");
  assert.equal(photoFeedback("CLEANING_REQUIRED").label, "Needs cleaning");
  assert.equal(
    photoFeedback("PRIVACY_HOLD").label,
    "Waiting for manager review",
  );
  assert.equal(photoFeedback("unknown").label, "Photo needed");
});

test("required progress excludes optional fixtures and views", () => {
  const manifest = {
    items: [
      {
        mandatory: true,
        requirements: [
          { id: "needed", mandatory: true },
          { id: "optional-view", mandatory: false },
        ],
      },
      {
        mandatory: false,
        requirements: [{ id: "optional-item", mandatory: true }],
      },
    ],
  } as Manifest;
  assert.deepEqual([...requiredPhotoIds(manifest)], ["needed"]);
});

test("Urdu instructions interpolate user names and preserve custom text", () => {
  assert.equal(
    translate("Hello, {name}", "ur", { name: "Ayesha" }).includes("Ayesha"),
    true,
  );
  assert.equal(
    translate("Untranslated custom text", "ur"),
    "Untranslated custom text",
  );

});

test("specific cleaning corrections retain named surfaces in Urdu without technical error codes", () => {
  const message=photoCorrection("Clean the basin and tap and take another photo.",(text,values)=>translate(text,"ur",values));
  assert.ok(message.includes("بیسن"));assert.ok(message.includes("نل"));assert.ok(message.includes("نئی تصویر"));assert.equal(message.includes("Clean the"),false);
});
