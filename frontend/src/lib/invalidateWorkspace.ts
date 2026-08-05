import type { QueryClient } from "@tanstack/react-query";

// Deletions affect lists, detail screens, assignment options, today's totals and billing usage.
const workspaceKeys = new Set([
  "operations",
  "review-page",
  "review-next",
  "follow-ups",
  "daily-schedule",
  "owner-trends",
  "exceptions",
  "exception",
  "exception-count",
  "verification-history",
  "verification-task",
  "today-status",
  "staff",
  "location",
  "getLocations",
  "getManagers",
  "dashboard-locations",
  "manager",
  "attendance",
  "subscription",
  "area-submissions",
  "area-review-preview",
  "area-daily-work",
  "area-migration",
  "areas",
  "area",
  "area-qr",
  "task-qr",
  "area-labels",
  "area-standards",
  "verification",
  "verification-exceptions",
]);
export async function invalidateWorkspace(client: QueryClient) {
  await client.invalidateQueries({
    predicate: (query) => workspaceKeys.has(String(query.queryKey[0])),
  });
}
