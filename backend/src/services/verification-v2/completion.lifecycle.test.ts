import { describe, it, expect, vi } from "vitest";
vi.mock("./captureSession.service.js", () => ({ lockTask: vi.fn() }));
vi.mock("../../prisma/prisma.js", () => ({ prisma: {} }));
import { itemState } from "./completion.service.js";
describe("item snapshot aggregation", () => {
  it("keeps mandatory passed views despite optional failures", () =>
    expect(
      itemState([
        { mandatory: true, state: "PASSED" },
        { mandatory: false, state: "REVIEW_REQUIRED" },
      ]),
    ).toBe("PASSED"));
  it("aggregates rework and processing without losing successes", () => {
    expect(
      itemState([
        { mandatory: true, state: "PASSED" },
        { mandatory: true, state: "CLEANING_REQUIRED" },
      ]),
    ).toBe("CLEANING_REQUIRED");
    expect(
      itemState([
        { mandatory: true, state: "PROCESSING" },
        { mandatory: true, state: "REVIEW_REQUIRED" },
      ]),
    ).toBe("REVIEW_REQUIRED");
  });
  it("preserves manual outcome and rejects empty snapshots", () => {
    expect(
      itemState([
        { mandatory: true, state: "PASSED" },
        { mandatory: true, state: "WAIVED" },
      ]),
    ).toBe("WAIVED");
    expect(itemState([{ mandatory: true, state: "MANAGER_ACCEPTED" }])).toBe(
      "MANAGER_ACCEPTED",
    );
    expect(itemState([])).toBe("MISSING");
  });
});
