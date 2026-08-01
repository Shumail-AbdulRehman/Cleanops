import { describe, expect, it } from "vitest";
import { reliabilityUrdu } from "./reliabilityTranslations.ts";
import { translate } from "./translations.ts";

const workerRequired = "Your plan does not assign staff automatically. Choose a worker for this schedule.";
const workerOverlap = "{name} already has an overlapping schedule: {title}. Choose a different time or worker.";
const shiftMismatch = "This time falls outside {name}'s shift ({start}–{end}). Choose a time inside the shift or update the shift.";
const moreCleaning = "AI result: more cleaning needed. You can accept this photo if it is clean.";

describe("web reliability translations", () => {
  it.each([workerRequired, workerOverlap, shiftMismatch, moreCleaning])(
    "has Urdu with the same placeholders for %s",
    (key) => {
      const urdu = reliabilityUrdu[key];
      expect(urdu).toMatch(/\p{Script=Arabic}/u);
      expect(urdu).not.toBe(key);
      expect((urdu.match(/\{\w+\}/g) ?? []).sort()).toEqual(
        (key.match(/\{\w+\}/g) ?? []).sort(),
      );
    },
  );

  it("translates and interpolates the shift mismatch message", () => {
    expect(translate(shiftMismatch, "ur", { name: "علی", start: "09:00", end: "17:00" })).toBe(
      "یہ وقت علی کی شفٹ (09:00–17:00) سے باہر ہے۔ شفٹ کے اندر کوئی وقت منتخب کریں یا شفٹ کے اوقات بدلیں۔",
    );
  });
});
