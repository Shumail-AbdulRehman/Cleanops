import StaffImportDialog from "./StaffImportDialog";
import StaffCreateDialog from "../Staff/StaffCreateDialog";
import DataTable from "@/components/common/DataTable";
import PersonAvatar from "@/components/workspace/PersonAvatar";
import StatusPill from "@/components/workspace/StatusPill";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Plus, ArrowUpRight } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { formatDays, isEveryDay, type Weekday } from "@/lib/workDays";
import { useLocationLanguage } from "./locationTranslations";
import type { LocationStaff } from "./types";
import "./location-tabs-v6.css";

type LocationStaffRow = LocationStaff & { workDays?: Weekday[] };

export interface LocationStaffTabProps {
  locationInfo: { id: number; name: string; timezone: string; isActive: boolean; staff: LocationStaffRow[] };
  locationTz: string;
  staffAdded: boolean;
  setStaffAdded: (value: boolean) => void;
  staffDialogOpen: boolean;
  setStaffDialogOpen: (value: boolean) => void;
}
const fmtTime = (d: string | null, timeZone: string) => d ? formatInTimeZone(new Date(d), timeZone, "HH:mm") : "—";

export default function LocationStaffTab({ locationInfo, locationTz, staffAdded, setStaffAdded, staffDialogOpen, setStaffDialogOpen }: LocationStaffTabProps) {
  const { t, language } = useLocationLanguage();
  return (
    <section className="wx-location-tab wx-location-staff" aria-label={t("Staff and shifts")}>
      <div className="wx-location-tab-heading">
        <div><h2>{t("Staff and shifts")}</h2><p>{t("Assigned staff and their shifts at this location")}</p></div>
        {locationInfo.isActive ? <div className="wx-location-tab-actions">
          <StaffImportDialog key={locationInfo.id} location={locationInfo} />
          <Button className="wx-location-tab-button wx-location-tab-button--primary" onClick={() => { setStaffAdded(false); setStaffDialogOpen(true); }}>
            <Plus size={16} aria-hidden="true" />{t("Add staff")}
          </Button>
        </div> : null}
      </div>
      {staffAdded ? <p className="wx-location-tab-saved" role="status">{t("Team member added.")}</p> : null}
      {staffDialogOpen ? <StaffCreateDialog open={staffDialogOpen} onOpenChange={setStaffDialogOpen} location={locationInfo} onSaved={() => setStaffAdded(true)} /> : null}
      <DataTable mobileCards data={locationInfo.staff ?? []} pageSize={20} rowKey={s => s.id}
        emptyMessage="No staff assigned to this location."
        columns={[
          { key: "name", header: "Staff", sortValue: s => s.name, render: s => <div className="wx-location-tab-person"><PersonAvatar name={s.name} /><div><strong><bdi>{s.name}</bdi></strong><small><span>{t("Phone")}: </span><span aria-label={t("Not available")}>—</span></small></div></div> },
          // The canonical location response does not select phone or attendance.
          // Keep unknown facts explicit rather than deriving attendance from isActive.
          {
            key: "email",
            header: "Email",
            sortValue: s => s.email ?? "",
            render: s => s.email ? <bdi>{s.email}</bdi> : <span className="text-muted-foreground">{t("No email")}</span>,
          },
          { key: "shift", header: "Shift", render: s => <>
            <bdi>{fmtTime(s.shiftStart, locationTz)} – {fmtTime(s.shiftEnd, locationTz)}</bdi>
            {s.workDays?.length && !isEveryDay(s.workDays) ? <> · <bdi>{formatDays(s.workDays, t, language)}</bdi></> : null}
          </> },
          { key: "today", header: "Today", render: () => <StatusPill>{t("Not available")}</StatusPill> },
          { key: "status", header: "Status", sortValue: s => s.isActive ? 1 : 0, render: s => <StatusPill tone={s.isActive ? "ok" : "neutral"} status={s.isActive ? "ACTIVE" : "INACTIVE"} /> },
          { key: "action", header: "Action", render: s => <Link className="wx-location-tab-button wx-location-tab-button--link" to={"/staff/" + s.id}>{t("View worker")}<ArrowUpRight size={15} aria-hidden="true" /></Link> },
        ]} />
      <div className="wx-location-tab-footer">
        <p>{t("Phone and today’s attendance are not included in this location record.")}</p>
        <Link className="wx-location-tab-button wx-location-tab-button--link" to={`/today-status?locationId=${locationInfo.id}&date=today&tab=staff`}>{t("View attendance")}</Link>
      </div>
    </section>
  );
}
