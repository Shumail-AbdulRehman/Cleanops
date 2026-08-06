import { afterEach, describe, expect, it, vi } from "vitest";
import { client } from "@/api/client";
import { assignStaffToLocation as assignFromAssignment } from "./api";
import { assignStaffToLocation as assignFromStaff } from "../Staff/api";

afterEach(() => vi.restoreAllMocks());

it("keeps both public exports bound to the same implementation", () => {
  expect(assignFromStaff).toBe(assignFromAssignment);
});

describe.each([
  ["Assignment/api", assignFromAssignment],
  ["Staff/api", assignFromStaff],
] as const)("%s", (_path, assignStaffToLocation) => {
  it("sends one PATCH with staff then location and returns the response data", async () => {
    const data = { data: { id: 17, locationId: 42 }, message: "Staff assigned" };
    const patch = vi.spyOn(client, "patch").mockResolvedValue({ data });

    await expect(assignStaffToLocation(17, 42)).resolves.toBe(data);

    expect(patch).toHaveBeenCalledExactlyOnceWith(
      "/assignment/staff/17/location/42",
    );
  });

  it("preserves a server permission rejection without retrying", async () => {
    const error = {
      response: { status: 403, data: { message: "Forbidden" } },
    };
    const patch = vi.spyOn(client, "patch").mockRejectedValue(error);

    await expect(assignStaffToLocation(17, 42)).rejects.toBe(error);

    expect(patch).toHaveBeenCalledExactlyOnceWith(
      "/assignment/staff/17/location/42",
    );
  });

  it("preserves connection failures without swallowing or replacing them", async () => {
    const error = new Error("Network Error");
    const patch = vi.spyOn(client, "patch").mockRejectedValue(error);

    await expect(assignStaffToLocation(17, 42)).rejects.toBe(error);

    expect(patch).toHaveBeenCalledExactlyOnceWith(
      "/assignment/staff/17/location/42",
    );
  });
});
