import { describe, expect, it } from "vitest";
import { createLocationSchema, editLocationSchema } from "./location.validation.js";
const valid = { name: "Blue Area Office", address: "Islamabad", latitude: "33.721500", longitude: "73.056000" };
describe("location map values", () => {
  it("keeps old callers compatible and accepts a bounded attendance radius", () => {
    expect(createLocationSchema.parse(valid).radiusMeters).toBeUndefined();
    expect(editLocationSchema.parse({ ...valid, radiusMeters: 100 }).radiusMeters).toBe(100);
    expect(createLocationSchema.parse({ ...valid, latitude: "0", longitude: "0", radiusMeters: 25 }).latitude).toBe("0");
  });
  it.each([0, 24, 5001, -100, 50.5, "100", NaN, Infinity])("rejects invalid radius %s", radiusMeters => {
    expect(createLocationSchema.safeParse({ ...valid, radiusMeters }).success).toBe(false);
  });
  it.each(["", " ", "NaN", "Infinity", "91"])('rejects invalid latitude "%s"', latitude => {
    expect(createLocationSchema.safeParse({ ...valid, latitude }).success).toBe(false);
  });
  it("rejects missing address/name and invalid longitude", () => {
    for (const invalid of [{ name: " " }, { address: "" }, { longitude: "181" }, { longitude: " " }]) {
      expect(createLocationSchema.safeParse({ ...valid, ...invalid }).success).toBe(false);
    }
  });
});
