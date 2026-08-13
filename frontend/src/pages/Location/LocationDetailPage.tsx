import LocationStaffTab from "./LocationStaffTab";
import LocationHistoryTab, { type TaskInstance, type TaskStatEntry } from "./LocationHistoryTab";
import { locationStatsFilter, type LocationHistoryPeriod } from "./locationStatsFilter";
import LocationOverview from "./LocationOverview";
import { useOperations, type OperationOverview } from "../Manager/operations";
import LocationFormDialog from "./LocationFormDialog";
import PageHeader from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import OperationsState from "../Manager/OperationsState";
import { useLocationLanguage } from "./locationTranslations";
import LocationAreasTab from "../Area/LocationAreasTab";
import DeleteButton from "@/components/common/DeleteButton";
import { useSelector } from "react-redux";
import type { RootState } from "@/store/store";
import React, { useEffect, useRef, useState } from "react";
import LocationScheduleTab from "./components/LocationScheduleTab";
import LocationTemplatesTab from "./components/LocationTemplatesTab";
import type { LocationStaff, TaskTemplate } from "./types";
import {
  useParams,
  useNavigate,
  useSearchParams,
  Link,
} from "react-router-dom";
import { useGetLocationById, useDeleteLocation } from "./queries";
import StatusPill from "@/components/workspace/StatusPill";
import WorkspaceTabs, { WorkspaceTabPanel } from "@/components/workspace/WorkspaceTabs";
import "./location-detail-v6.css";
import { ArrowLeft, Clock, MapPin, Navigation, Radius, Settings2, Pencil } from "lucide-react";

const fmtCoord = (v: string) => parseFloat(v).toFixed(6);
type FilterKey = LocationHistoryPeriod;

type Tab =
  "overview" | "areas" | "staff" | "templates" | "instances" | "schedule";
const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "areas", label: "Area template" },
  { value: "templates", label: "Cleaning schedule" },
  { value: "staff", label: "Staff and shifts" },
  { value: "instances", label: "Task history" },
  // Existing read-only weekly preview is preserved alongside the approved tabs.
  { value: "schedule", label: "Weekly schedule" },
];

function LocationMapTile() {
  return <svg className="wx-location-detail-map" viewBox="0 0 220 124" aria-hidden="true" focusable="false">
    <rect width="220" height="124" rx="8" className="wx-location-detail-map__ground" />
    <path d="M0 48H220M0 106H220M67 0L80 124M145 0L158 124" className="wx-location-detail-map__streets" />
    <circle cx="121" cy="57" r="24" className="wx-location-detail-map__radius" />
    <rect x="113" y="49" width="16" height="16" rx="3" className="wx-location-detail-map__pin" />
  </svg>;
}

interface LocationInfo {
  id: number;
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  timezone: string;
  radiusMeters: number;
  isActive: boolean;
  staff: LocationStaff[];
  taskTemplates: TaskTemplate[];
  taskInstances: TaskInstance[];
}

const LocationDetailPage: React.FC = () => {
  const { t } = useLocationLanguage();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [staffDialogOpen, setStaffDialogOpen] = useState(false);
  const [staffAdded, setStaffAdded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const user = useSelector((state: RootState) => state.auth.user);
  const deleteLocation = useDeleteLocation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [searchParams, setSearchParams] = useSearchParams();
  const taskParam = searchParams.get("taskId") ?? "";
  const selectedTaskId = /^[1-9]\d*$/.test(taskParam)
    ? Number(taskParam)
    : null;
  const taskHistoryRef = useRef<HTMLElement>(null);
  const activeTab =
    TABS.find((tab) => tab.value === searchParams.get("tab"))?.value ?? (selectedTaskId ? "instances" : "overview");
  const setActiveTab = (tab: Tab) =>
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("tab", tab);
      return next;
    });
  const [qrTaskId, setQrTaskId] = useState<number | null>(null);
  const [expandedInstanceId, setExpandedInstanceId] = useState<number | null>(
    null,
  );

  // Keep the canonical detail reactive. Both observers share the same initial
  // query key, so TanStack deduplicates that request before filters are chosen.
  const canonicalDetail=useGetLocationById(id!);
  const historyTimezone=canonicalDetail.data?.data?.locationInfo?.timezone;
  const filter=locationStatsFilter(activeFilter,historyTimezone);

  const overviewParams = { locationId: id ?? "", date: "today" };
  const overview = useOperations<OperationOverview>(
    "overview",
    overviewParams,
    !!id,
  );
  const filteredDetail = useGetLocationById(id!, filter);
  const detailQuery = activeFilter === "all" ? canonicalDetail : filteredDetail;
  const { data, isLoading, isFetching } = detailQuery;
  const locationInfo = data?.data?.locationInfo as LocationInfo | undefined;
  const taskStats: TaskStatEntry[] = data?.data?.taskStats ?? [];
  useEffect(() => {
    if (
      activeTab !== "instances" ||
      !selectedTaskId ||
      isLoading ||
      detailQuery.isError
    )
      return;
    const frame = requestAnimationFrame(() => {
      taskHistoryRef.current?.scrollIntoView({
        block: "start",
        behavior: "instant",
      });
      taskHistoryRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTab, selectedTaskId, isLoading, detailQuery.isError]);

  const locationTz = locationInfo?.timezone ?? "UTC";

  const status = (detailQuery.error as { response?: { status?: number } } | null)?.response?.status;
  const unavailable = detailQuery.isError && (!locationInfo || [401, 403, 404, 410].includes(status ?? 0));
  const returnLink = <Link className="wx-location-detail-action wx-location-detail-back" to="/locations"><ArrowLeft size={16} aria-hidden="true" />{t("Return to locations")}</Link>;

  if (status === 404 || (!isLoading && !detailQuery.isError && !locationInfo)) {
    return <div className="wx-location-detail-page"><PageHeader title={t("Location not found")} />
      <p>{t("No saved location is available at this address.")}</p>{returnLink}</div>;
  }
  if (isLoading && !locationInfo) {
    return <div className="wx-location-detail-page"><PageHeader title={t("Location")} /><OperationsState loading layout="location-detail" />{returnLink}</div>;
  }
  if (unavailable || !locationInfo) {
    return <div className="wx-location-detail-page"><PageHeader title={t("Location")} />
      <OperationsState error={detailQuery.error} retry={() => void detailQuery.refetch()} />{returnLink}</div>;
  }

  return (
    <div className="wx-location-detail-page">
      {returnLink}
      <header className="wx-location-detail-header">
        <LocationMapTile />
        <div className="wx-location-detail-identity">
          <div className="wx-location-detail-title"><h1><bdi>{locationInfo.name}</bdi></h1><StatusPill tone={locationInfo.isActive ? "ok" : "neutral"} status={locationInfo.isActive ? "ACTIVE" : "INACTIVE"} /></div>
          <p className="wx-location-detail-address"><MapPin size={16} aria-hidden="true" /><bdi>{locationInfo.address}</bdi></p>
          <div className="wx-location-detail-meta">
            <span><Clock size={15} aria-hidden="true" /><bdi>{locationInfo.timezone}</bdi></span>
            <span><Radius size={15} aria-hidden="true" />{t("Check-in radius {radius} m", { radius: locationInfo.radiusMeters })}</span>
          </div>
        </div>
        <div className="wx-location-detail-actions">
          {user?.role === "ADMIN" ? <Button className="wx-location-detail-action" variant="outline" onClick={() => { setSaved(false); setEditOpen(true); }}><Pencil size={16} aria-hidden="true" />{t("Edit location")}</Button> : null}
          <Button className="wx-location-detail-action" variant="ghost" aria-expanded={settingsOpen} aria-controls="location-settings" onClick={() => setSettingsOpen(!settingsOpen)}><Settings2 size={16} aria-hidden="true" />{t("Location settings")}</Button>
        </div>
      </header>
      <OperationsState error={detailQuery.error} retry={() => void detailQuery.refetch()} />
      {user?.role === "ADMIN" ? (
        <LocationFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          location={locationInfo}
          onSaved={() => {
            setEditOpen(false);
            setSaved(true);
            setActiveFilter("all");
          }}
        />
      ) : null}
      {saved ? (
        <p className="wx-location-detail-saved" role="status">
          {t("Location updated.")}
        </p>
      ) : null}
      {settingsOpen ? (
        <section className="wx-location-detail-settings" id="location-settings" aria-label={t("Location settings")}>
          <div className="wx-location-detail-settings-heading">
            <h2>{t("Location settings")}</h2>
            {user?.role === "ADMIN" ? (
              <Button
                className="wx-location-detail-action"
                variant="outline"
                onClick={() => {
                  setSaved(false);
                  setEditOpen(true);
                }}
              >
                <MapPin size={16} />
                {t("Edit location")}
              </Button>
            ) : null}
          </div>
          <div className="wx-location-detail-meta">
            <span>
              <Navigation size={14} aria-hidden="true" />{" "}
              {fmtCoord(locationInfo.latitude)},{" "}
              {fmtCoord(locationInfo.longitude)}
            </span>
            <span>
              <Radius size={14} aria-hidden="true" />{" "}
              {locationInfo.radiusMeters} m
            </span>
            <span>
              <Clock size={14} aria-hidden="true" /> {locationInfo.timezone}
            </span>
          </div>
          {user?.role === "ADMIN" ? (
            <DeleteButton
              name={locationInfo.name}
              description="This location, its schedules, task history, attendance, and evidence records will be removed. Staff accounts will stay, with their location and shift cleared."
              onDelete={async () => {
                await deleteLocation.mutateAsync(locationInfo.id);
                navigate("/locations", { replace: true });
              }}
            />
          ) : null}
        </section>
      ) : null}
      <WorkspaceTabs className="wx-location-detail-tabs" label="Location sections" value={activeTab} tabs={TABS} onChange={value => setActiveTab(value as Tab)}>
      <WorkspaceTabPanel value="overview"><LocationOverview location={locationInfo} onTab={setActiveTab} overview={overview} /></WorkspaceTabPanel>
      <WorkspaceTabPanel value="staff"><LocationStaffTab locationInfo={locationInfo} locationTz={locationTz} staffAdded={staffAdded} setStaffAdded={setStaffAdded} staffDialogOpen={staffDialogOpen} setStaffDialogOpen={setStaffDialogOpen} /></WorkspaceTabPanel>

      <WorkspaceTabPanel value="areas">{id && (
        <LocationAreasTab locationId={Number(id)} />
      )}</WorkspaceTabPanel>

      <WorkspaceTabPanel value="schedule">{id && (
        <LocationScheduleTab locationId={id} />
      )}</WorkspaceTabPanel>

      <WorkspaceTabPanel value="templates">
        <LocationTemplatesTab
          templates={locationInfo.taskTemplates ?? []}
          staffList={locationInfo.staff ?? []}
          locationId={locationInfo.id}
          timeZone={locationTz}
          locationName={locationInfo.name}
        />
      </WorkspaceTabPanel>

      <WorkspaceTabPanel value="instances">{id && <LocationHistoryTab id={id} locationInfo={locationInfo} locationTz={locationTz} historyTimezone={historyTimezone} taskHistoryRef={taskHistoryRef} selectedTaskId={selectedTaskId} activeFilter={activeFilter} setActiveFilter={setActiveFilter} isFetching={isFetching} taskStats={taskStats} searchParams={searchParams} setSearchParams={setSearchParams} qrTaskId={qrTaskId} setQrTaskId={setQrTaskId} expandedInstanceId={expandedInstanceId} setExpandedInstanceId={setExpandedInstanceId} />}</WorkspaceTabPanel>
      </WorkspaceTabs>
    </div>
  );
};

export default LocationDetailPage;
