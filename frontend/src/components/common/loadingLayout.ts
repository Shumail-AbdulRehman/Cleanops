export type PageLoadingLayout =
  | "owner-overview"
  | "manager-overview"
  | "today"
  | "today-summary"
  | "today-table"
  | "locations"
  | "location-detail"
  | "team"
  | "team-detail"
  | "attendance"
  | "managers"
  | "billing"
  | "reviews"
  | "review-detail"
  | "verification"
  | "area"
  | "area-setup"
  | "schedule"
  | "area-table"
  | "staff-preview"
  | "task-summary"
  | "trends"
  | "records";

/** The lazy-module fallback and the data-loading state resolve to the same layout. */
export function pageLoadingLayout(
  pathname: string,
  owner: boolean,
): PageLoadingLayout {
  pathname = pathname.replace(/\/+$/, "");
  if (/^\/staff\/[^/]+/.test(pathname)) return "team-detail";
  if (pathname === "/staff") return "team";
  if (/^\/locations\/[^/]+\/areas\/new/.test(pathname)) return "area-setup";
  if (/^\/locations\/[^/]+/.test(pathname)) return "location-detail";
  if (pathname === "/locations") return "locations";
  if (pathname === "/attendance") return "attendance";
  if (pathname === "/managers") return "managers";
  if (pathname === "/subscription") return "billing";
  if (/^\/exceptions\/[^/]+/.test(pathname)) return "review-detail";
  if (pathname === "/exceptions") return "reviews";
  if (/^\/verification\//.test(pathname)) return "verification";
  if (/^\/areas\//.test(pathname)) return "area";
  if (pathname === "/today-status") return "today";
  if (pathname === "/dashboard")
    return owner ? "owner-overview" : "manager-overview";
  return "records";
}

export function pageLoadingTab(
  layout: PageLoadingLayout,
  requested: string | null,
): string {
  const tabs =
    layout === "team-detail"
      ? ["overview", "templates", "instances", "attendance"]
      : layout === "location-detail"
        ? ["overview", "staff", "areas", "schedule", "templates", "instances"]
        : layout === "area"
          ? ["inventory", "tasks", "schedules", "qr", "standards", "history"]
          : ["overview"];
  return requested && tabs.includes(requested) ? requested : tabs[0]!;
}
