import { ApiError } from "./ApiError.js";

type ScopedUser = {
    role: "ADMIN" | "MANAGER" | "STAFF";
    locationIds?: number[];
};

/**
 * Returns null when the user has unrestricted, company-wide location access
 * (ADMIN); otherwise the list of location ids the user may access (MANAGER).
 */
export function getScopedLocationIds(user: ScopedUser): number[] | null {
    if (user.role === "ADMIN") return null;
    return user.locationIds ?? [];
}

/**
 * Throws 403 when a MANAGER tries to access a location outside their
 * assigned set. No-op for ADMIN.
 */
export function assertLocationAccess(user: ScopedUser, locationId: number) {
    const scopedIds = getScopedLocationIds(user);
    if (scopedIds !== null && !scopedIds.includes(locationId)) {
        throw new ApiError(403, "You do not have access to this location");
    }
}
