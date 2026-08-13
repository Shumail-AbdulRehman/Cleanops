import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useSelector } from "react-redux";
import { ArrowDown, ArrowRight, ArrowUp, Layers, MapPin, Plus } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import EmptyState from "@/components/common/EmptyState";
import Pagination from "@/components/common/Pagination";
import FindField from "@/components/workspace/FindField";
import SelectMenu from "@/components/workspace/SelectMenu";
import StatusPill from "@/components/workspace/StatusPill";
import type { RootState } from "@/store/store";
import OperationsState from "../Manager/OperationsState";
import { useOperations, type OperationOverview } from "../Manager/operations";
import { useGetLocations } from "./queries";
import { useLocationLanguage } from "./locationTranslations";
import LocationFormDialog from "./LocationFormDialog";
import type { LocationWithCounts } from "./types";
import "./locations-v6.css";

const sortOptions = [
  { value: "", label: "Default order" },
  { value: "location", label: "Location" },
  { value: "staff", label: "Staff present" },
  { value: "tasks", label: "Submitted / due" },
  { value: "review", label: "Waiting for review" },
  { value: "status", label: "Status" },
];

/** Decorative artwork only; it represents neither the saved coordinates nor a live map. */
function LocationMap() {
  return <svg className="wx-locations-map" viewBox="0 0 104 78" aria-hidden="true" focusable="false">
    <rect width="104" height="78" rx="8" className="wx-locations-map-ground" />
    <path d="M28 0 36 78M72 0 80 78M0 30H104M0 64H104" className="wx-locations-map-streets" />
    <circle cx="52" cy="39" r="22" className="wx-locations-map-radius" />
    <rect x="47" y="34" width="10" height="10" rx="1" className="wx-locations-map-site" />
  </svg>;
}

export default function LocationsPage() {
  const { t, language } = useLocationLanguage();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [sort, setSort] = useState("");
  const [descending, setDescending] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [success, setSuccess] = useState("");
  const operations = useOperations<OperationOverview>("overview", { date: "today" });
  const getLocations = useGetLocations(true);
  const user = useSelector((s: RootState) => s.auth.user);
  const isAdmin = user?.role === "ADMIN";
  const [params, setParams] = useSearchParams();
  const dialogOpen = params.get("create") === "1";
  const setDialogOpen = (open: boolean) => setParams(previous => {
    const result = new URLSearchParams(previous);
    if (open) result.set("create", "1"); else result.delete("create");
    return result;
  }, { replace: true });
  const status = (getLocations.error as { response?: { status?: number } } | null)?.response?.status;
  const locations: LocationWithCounts[] | undefined = status === 401 || status === 403 ? undefined : getLocations.data?.data;
  const daily = new Map((operations.isError ? [] : operations.data?.comparison ?? []).map(row => [row.location.id, row]));
  const filtered = (locations ?? []).filter(loc =>
    (statusFilter === "all" || loc.isActive === (statusFilter === "active")) &&
    (loc.name + " " + loc.address).toLowerCase().includes(search.toLowerCase()));
  const sortValue = (loc: LocationWithCounts): string | number => {
    const row = daily.get(loc.id);
    switch (sort) {
      case "location": return loc.name;
      case "staff": return row?.present ?? -1;
      case "tasks": return row?.submitted ?? -1;
      case "review": return row?.reviews ?? -1;
      case "status": return loc.isActive ? 1 : 0;
      default: return 0;
    }
  };
  const sorted = sort ? [...filtered].sort((a, b) => {
    const x = sortValue(a), y = sortValue(b);
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * (descending ? -1 : 1);
  }) : filtered;
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const number = (value: number) => value.toLocaleString(language === "ur" ? "ur-PK" : "en-PK");
  const add = <button type="button" className="wx-locations-button wx-locations-primary" onClick={() => setDialogOpen(true)}><Plus size={16} aria-hidden="true" />{t("Add location")}</button>;
  const clearFilters = () => { setSearch(""); setStatusFilter("active"); setPage(1); };

  return <div className="wx-locations-page">
    <PageHeader title="Locations" subtitle={t("See your sites, teams, and today’s cleaning work.")}
      tools={locations?.length ? <FindField label="Search locations" placeholder="Search by name or address" value={search} onChange={value => { setSearch(value); setPage(1); }} /> : undefined}
      action={isAdmin ? add : undefined} />
    {isAdmin && <LocationFormDialog open={dialogOpen} onOpenChange={setDialogOpen} onSaved={() => {
      setDialogOpen(false);
      setSuccess("Location created. Add areas and assign your team to get started.");
    }} />}
    {success && <p className="wx-locations-success" role="status">{t(success)}</p>}
    {getLocations.isError && <OperationsState error={getLocations.error} retry={() => void getLocations.refetch()} />}
    {!locations ? getLocations.isPending && <OperationsState loading layout="locations" /> : <>
      <OperationsState />
      <dl className="wx-locations-summary">
        <div><dt>{t("Active locations")}</dt><dd>{number(locations.filter(loc => loc.isActive).length)}</dd></div>
        <div><dt>{t("Assigned staff")}</dt><dd>{number(locations.reduce((sum, loc) => sum + loc._count.staff, 0))}</dd></div>
        <div><dt>{t("Cleaning schedules")}</dt><dd>{number(locations.reduce((sum, loc) => sum + loc._count.taskTemplates, 0))}</dd></div>
      </dl>
      {locations.length > 0 && <>
        <div className="wx-locations-filters">
          <SelectMenu label="Location status" value={statusFilter} options={[
            { value: "active", label: "Active locations" }, { value: "inactive", label: "Inactive locations" }, { value: "all", label: "All locations" },
          ]} onChange={value => { setStatusFilter(value); setPage(1); }} />
          <SelectMenu label="Sort by" value={sort} options={sortOptions} onChange={value => { setSort(value); setDescending(false); setPage(1); }} />
          {sort && <button type="button" className="wx-locations-button" aria-label={t(descending ? "Sort ascending" : "Sort descending")} onClick={() => { setDescending(value => !value); setPage(1); }}>
            {descending ? <ArrowDown size={16} aria-hidden="true" /> : <ArrowUp size={16} aria-hidden="true" />}{t(descending ? "Descending" : "Ascending")}
          </button>}
          {filtered.length > 0 && (search || statusFilter !== "active") && <button type="button" className="wx-locations-button" onClick={clearFilters}>{t("Clear filters")}</button>}
        </div>
        {operations.isPending && <p className="wx-locations-notice" role="status">{t("Checking today’s work…")}</p>}
        {operations.isError && <div className="wx-locations-notice" role="alert"><p>{t("Today’s attendance and task totals are unavailable.")}</p>
          <button type="button" className="wx-locations-button" disabled={operations.isFetching} aria-busy={operations.isFetching} onClick={() => void operations.refetch()}>{t("Retry")}</button>
        </div>}
      </>}
      {locations.length === 0 ? <EmptyState icon={<MapPin />} title={isAdmin ? "Add your first location" : "No assigned locations yet"}
        message={isAdmin ? "A location holds its check-in boundary, staff, areas and cleaning schedules. Everything else starts here." : "No locations assigned to you yet. Contact your admin."}
        action={isAdmin ? add : undefined} /> : filtered.length === 0 ? <EmptyState icon={<MapPin />} message="No locations match these filters."
          action={<button type="button" className="wx-locations-button" onClick={clearFilters}>{t("Clear filters")}</button>} /> : <>
        <ul className="wx-locations-grid" aria-label={t("Location register")}>
          {visible.map(loc => {
            const row = daily.get(loc.id);
            return <li key={loc.id}>
              <Link to={"/locations/" + loc.id} className="wx-location-card" aria-labelledby={`wx-location-${loc.id}`}>
                <div className="wx-location-card-heading"><LocationMap /><div className="wx-location-card-name">
                  <h2 id={`wx-location-${loc.id}`}><bdi>{loc.name}</bdi></h2><p><bdi>{loc.address}</bdi></p>
                </div><StatusPill tone={loc.isActive ? "ok" : "neutral"} status={loc.isActive ? "ACTIVE" : "INACTIVE"} /></div>
                <dl className="wx-location-card-figures">
                  <div><dt>{t("Staff present")}</dt><dd>{row ? <bdi>{number(row.present)} <small>{t("of")} {number(row.scheduled)}</small></bdi> : <span aria-label={t("Information unavailable")}>—</span>}</dd></div>
                  <div><dt>{t("Submitted / due")}</dt><dd>{row ? <bdi>{number(row.submitted)} <small>{t("of")} {number(row.tasks)}</small></bdi> : <span aria-label={t("Information unavailable")}>—</span>}</dd></div>
                  <div><dt>{t("Waiting for review")}</dt><dd>{row ? <span className={row.reviews > 0 ? "wx-location-card-reviews" : undefined}>{number(row.reviews)}</span> : <span aria-label={t("Information unavailable")}>—</span>}</dd></div>
                </dl>
                <span className="wx-location-card-open">{t("Open")}<ArrowRight size={14} aria-hidden="true" /></span>
              </Link>
            </li>;
          })}
          {isAdmin && <li><button type="button" className="wx-location-add" onClick={() => setDialogOpen(true)}><Plus size={20} aria-hidden="true" />{t("Add location")}</button></li>}
        </ul>
        {sorted.length > 20 && <Pagination page={currentPage} pageSize={pageSize} total={sorted.length} totalPages={pages} onPage={setPage} onSize={size => { setPageSize(size); setPage(1); }} />}
      </>}
      <aside className="wx-locations-guide"><Layers size={22} aria-hidden="true" /><div><strong>{t("Inside a location")}</strong><p>{t("Open a site to manage its areas and fixtures, staff and shifts, cleaning schedules, and photo reviews.")}</p></div></aside>
    </>}
  </div>;
}
