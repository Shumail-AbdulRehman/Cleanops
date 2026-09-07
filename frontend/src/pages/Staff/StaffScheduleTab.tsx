import { useLanguage } from '@/i18n/context';
import DataTable from '@/components/common/DataTable';
import StatusPill from '@/components/workspace/StatusPill';
import { formatDays, isEveryDay, type Weekday } from '@/lib/workDays';
import './staff-tabs-v6.css';
import { formatInTimeZone } from 'date-fns-tz';
export interface StaffTaskTemplateRow {
  id: number;
  title: string;
  description?: string | null;
  recurringType?: string | null;
  repeatDays?: Weekday[];
  isActive: boolean;
  location?: { name?: string | null; timezone?: string | null } | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  effectiveDate: string | null;
}

const fmtTime = (d: string | null, timeZone = "UTC") => {
  if (!d) return "—";
  return formatInTimeZone(new Date(d), timeZone, "HH:mm");
};
export interface StaffScheduleTabProps { staff: { taskTemplates: StaffTaskTemplateRow[] } }
export default function StaffScheduleTab({ staff }: StaffScheduleTabProps) {
const {t,language}=useLanguage();const locale=language==='ur'?'ur-PK':'en-PK';
  const fmtDate=(date:string|null)=>date?new Date(date).toLocaleDateString(locale,{timeZone:'UTC'}):'—';
return <section className="wx-staff-tab wx-staff-tab-schedule" aria-label={t('Cleaning schedule')}><DataTable<StaffTaskTemplateRow> mobileCards
          data={staff.taskTemplates}
          pageSize={20}
          rowKey={(row) => row.id}
          emptyMessage="No active cleaning schedules assigned."
          columns={[
            {
              key: "title",
              header: "Cleaning schedule",
              sortValue: (row) => row.title,
              render: (row) => (
                <div>
                  <strong><bdi>{row.title}</bdi></strong>
                  {row.description ? <p className="wx-staff-tab-description"><bdi>{row.description}</bdi></p> : null}
                </div>
              ),
            },
            {
              key: "location",
              header: "Location",
              sortValue: (row) => row.location?.name ?? "",
              render: (row) => <bdi>{row.location?.name ?? "—"}</bdi>,
            },
            {
              key: "shift",
              header: "Shift",
              render: (row) => <bdi>{
                fmtTime(row.shiftStart, row.location?.timezone ?? "UTC") +
                " – " +
                fmtTime(row.shiftEnd, row.location?.timezone ?? "UTC")}</bdi>,
            },
            {
              key: "recurrence",
              header: "Recurrence",
              render: (row) => (
                <StatusPill status={row.recurringType ?? "ONCE"}>
                  {row.recurringType === "DAILY" && row.repeatDays?.length && !isEveryDay(row.repeatDays)
                    ? formatDays(row.repeatDays, t, language)
                    : undefined}
                </StatusPill>
              ),
            },
            {
              key: "effective",
              header: "Effective",
              sortValue: (row) => row.effectiveDate ?? "",
              render: (row) => <bdi>{fmtDate(row.effectiveDate)}</bdi>,
            },
            {
              key: "status",
              header: "Status",
              render: (row) => (
                <StatusPill tone={row.isActive ? "ok" : "neutral"} status={row.isActive ? "ACTIVE" : "INACTIVE"} />
              ),
            },
          ]}
        /></section>;
}
