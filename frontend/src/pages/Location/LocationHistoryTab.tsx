import type { Ref } from "react";
import { Link, type SetURLSearchParams } from "react-router-dom";
import { formatInTimeZone } from "date-fns-tz";
import { ChevronUp, ChevronDown } from "lucide-react";
import TaskQr from "../Task/components/TaskQr";
import AreaSubmissionsPanel from "../Task/components/AreaSubmissionsPanel";
import DataTable from "@/components/common/DataTable";
import TaskWorker from "@/components/common/TaskWorker";
import PersonAvatar from "@/components/workspace/PersonAvatar";
import StatusPill, { type StatusPillTone } from "@/components/workspace/StatusPill";
import { Button } from "@/components/ui/button";
import { verificationLabel } from "../Verification/presentation";
import { taskAssignee } from "../Task/taskAssignee";
import { useLocationLanguage } from "./locationTranslations";
import type { LocationStaff, ReferenceImage } from "./types";
import type { LocationHistoryPeriod } from "./locationStatsFilter";
import "./location-tabs-v6.css";

const FILTERS: { key: LocationHistoryPeriod; label: string }[] = [
  { key: "today", label: "Today" }, { key: "yesterday", label: "Yesterday" },
  { key: "7days", label: "Last 7 Days" }, { key: "all", label: "All Time" },
];
const fmtTime = (d: string | null, timeZone: string) => d ? formatInTimeZone(new Date(d), timeZone, "HH:mm") : "—";

export interface TaskStatEntry {
  status: string;
  _count: { status: number };
}

interface TaskAssignment {
  id: number;
  staffId: number;
  status: string;
  reason?: string | null;
  isCurrent: boolean;
  assignedAt: string;
  staff?: {
    id: number;
    name: string;
    email?: string;
  } | null;
}

export interface TaskInstance {
  id: number;
  staffId: number | null;
  title: string;
  date: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  status: string;
  verificationVersion?: number;
  verificationState?: string;
  completionOutcome?: string | null;
  staffSubmittedAt?: string | null;
  isLate?: boolean;
  lateMinutes?: number | null;
  proofImageUrls?: string[];
  referenceImages?: ReferenceImage[];
  assignments?: TaskAssignment[];
  completionAttempts?: CompletionAttempt[];
}

interface CompletionAttempt {
  id: number;
  status: "APPROVED" | "REJECTED_LOCATION" | "REJECTED_CLEANLINESS" | "ERROR";
  areaName: string | null;
  submissionId: string | null;
  locationMatchScore: number | null;
  cleanlinessMatchScore: number | null;
  locationMatchReason: string | null;
  cleanlinessReason: string | null;
  imageUrl: string;
  createdAt: string;
}

const workTone = (status: string): StatusPillTone =>
  ["COMPLETED", "IN_PROGRESS"].includes(status) ? "progress" :
  ["MISSED", "NOT_COMPLETED_INTIME"].includes(status) ? "bad" : "neutral";

function VerificationCell({ task }: { task: TaskInstance }) {
  const { t } = useLocationLanguage();
  if (task.verificationVersion === 2) {
    const tone = task.completionOutcome === "VERIFIED_COMPLETE" || task.verificationState === "VERIFIED" ? "ok" :
      task.verificationState === "NEEDS_REVIEW" ? "attention" : "neutral";
    return <StatusPill tone={tone}>{t(verificationLabel(task))}</StatusPill>;
  }
  const grouped = (task.completionAttempts ?? []).reduce<Record<string, CompletionAttempt[]>>((groups, attempt) => {
    const key = attempt.submissionId ?? `single-${attempt.id}`;
    (groups[key] ??= []).push(attempt);
    return groups;
  }, {});
  const latestGroup = Object.values(grouped)[0] ?? [];
  if (!latestGroup.length) return <span>—</span>;
  return <div className="wx-location-tab-attempts">{latestGroup.map(attempt => {
    const label = attempt.status === "APPROVED" ? "Approved" : attempt.status === "REJECTED_LOCATION" ? "Wrong area" : attempt.status === "REJECTED_CLEANLINESS" ? "Not clean enough" : "Error";
    const reason = attempt.status === "REJECTED_LOCATION" ? attempt.locationMatchReason : attempt.status === "REJECTED_CLEANLINESS" ? attempt.cleanlinessReason : null;
    return <div className="wx-location-tab-attempt" key={attempt.id}>
      {attempt.areaName ? <strong><bdi>{attempt.areaName}</bdi></strong> : null}
      <StatusPill tone={attempt.status === "APPROVED" ? "ok" : "bad"}>{t(label)}</StatusPill>
      {attempt.locationMatchScore != null && attempt.cleanlinessMatchScore != null ? <p>{t("Location score {location} · Cleanliness score {cleanliness}", { location: attempt.locationMatchScore, cleanliness: attempt.cleanlinessMatchScore })}</p> : null}
      {reason ? <p><bdi>{reason}</bdi></p> : null}
      {attempt.status === "ERROR" ? <p>{t("Verification failed")}</p> : null}
    </div>;
  })}</div>;
}

export interface LocationHistoryTabProps {
  id: string;
  locationInfo: { staff: LocationStaff[]; taskInstances: TaskInstance[] };
  locationTz: string;
  historyTimezone?: string;
  taskHistoryRef: Ref<HTMLElement>;
  selectedTaskId: number | null;
  activeFilter: LocationHistoryPeriod;
  setActiveFilter: (value: LocationHistoryPeriod) => void;
  isFetching: boolean;
  taskStats: TaskStatEntry[];
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
  qrTaskId: number | null;
  setQrTaskId: (value: number | null) => void;
  expandedInstanceId: number | null;
  setExpandedInstanceId: (value: number | null) => void;
}

export default function LocationHistoryTab({ id, locationInfo, locationTz, historyTimezone, taskHistoryRef, selectedTaskId, activeFilter, setActiveFilter, isFetching, taskStats, searchParams, setSearchParams, qrTaskId, setQrTaskId, expandedInstanceId, setExpandedInstanceId }: LocationHistoryTabProps) {
  const { t, language } = useLocationLanguage();
  const currentFilter = FILTERS.find(f => f.key === activeFilter)!;
  const withStaff = (task: TaskInstance) => ({ ...task, staff: locationInfo.staff.find(s => s.id === task.staffId) });
  return (
    <section ref={taskHistoryRef} id="location-task-history" tabIndex={-1}
      aria-label={t("Task history")} aria-busy={isFetching} data-task-id={selectedTaskId ?? undefined}
      className="wx-location-tab wx-location-history">
      <div className="wx-location-tab-heading">
        <div><h2>{t("Task history")}</h2><p>{t("Tasks in period")} · {t(currentFilter.label)}</p></div>
        <div className="wx-location-tab-periods" role="group" aria-label={t("Task history period")}>
          {FILTERS.map(f => <button type="button" key={f.key} className="wx-location-tab-button"
            aria-pressed={activeFilter === f.key} disabled={!historyTimezone && ["today", "yesterday"].includes(f.key)}
            onClick={() => setActiveFilter(f.key)}>{t(f.label)}</button>)}
        </div>
      </div>
      {taskStats.length ? <div className="wx-location-tab-statuses">{taskStats.map(entry => <span key={entry.status}>
        <StatusPill status={entry.status} tone={workTone(entry.status)} /><strong>{entry._count.status.toLocaleString(language === "ur" ? "ur-PK" : "en-PK")}</strong>
      </span>)}</div> : null}
      {selectedTaskId ? <div className="wx-location-tab-selection"><h3>{t("Selected task")}</h3>
        <Button className="wx-location-tab-button" variant="outline" onClick={() => setSearchParams(previous => {
          const next = new URLSearchParams(previous); next.delete("taskId"); next.set("tab", "instances"); return next;
        })}>{t("Show all tasks")}</Button>
      </div> : null}
      {isFetching ? <p className="wx-location-tab-updating" role="status">{t("Updating…")}</p> : null}
      {qrTaskId ? <div className="wx-location-tab-qr"><TaskQr key={qrTaskId} taskId={qrTaskId} initialOpen /></div> : null}
      <DataTable mobileCards selectedRowKey={selectedTaskId} key={selectedTaskId ?? "all"}
        data={(locationInfo.taskInstances ?? []).filter(task => !selectedTaskId || task.id === selectedTaskId)}
        pageSize={20} rowKey={task => task.id}
        emptyMessage={selectedTaskId ? "This task is not available for this location and period." : "No task instances for this period."}
        expandedRow={task => expandedInstanceId === task.id ? <AreaSubmissionsPanel taskInstanceId={task.id} /> : null}
        columns={[
          { key: "date", header: "Date", sortValue: task => task.date, render: task => <div className="wx-location-tab-time">
            <bdi>{new Date(task.date).toLocaleDateString(language === "ur" ? "ur-PK" : "en-PK", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</bdi>
            <small><bdi>{fmtTime(task.shiftStart, locationTz)} – {fmtTime(task.shiftEnd, locationTz)}</bdi></small>
          </div> },
          { key: "title", header: "Task", sortValue: task => task.title, render: task => <strong><bdi>{task.title}</bdi></strong> },
          { key: "staff", header: "Assigned to", sortValue: task => taskAssignee(withStaff(task)).worker?.name ?? "", render: task => {
            const reassigned = Math.max((task.assignments?.length ?? 0) - 1, 0);
            return <div className="wx-location-tab-person"><PersonAvatar size="small" name={taskAssignee(withStaff(task)).worker?.name} /><div>
              <TaskWorker task={withStaff(task)} details />
              {reassigned > 0 ? <small>{reassigned} {t("reassigned")}</small> : null}
            </div></div>;
          } },
          { key: "status", header: "Work status", render: task => {
            const submitted = Boolean(task.staffSubmittedAt || task.status === "COMPLETED");
            const label = submitted ? "Work submitted" : task.status === "IN_PROGRESS" ? "In progress" : ["MISSED", "NOT_COMPLETED_INTIME"].includes(task.status) ? "Overdue" : task.status === "CANCELLED" ? "Cancelled" : "Not started";
            return <div className="wx-location-tab-work"><StatusPill tone={submitted ? "progress" : workTone(task.status)}>{t(label)}</StatusPill>
              <small>{t("Late start")}: {task.isLate ? <bdi>+{task.lateMinutes ?? "?"}m</bdi> : t("No late start recorded")}</small>
            </div>;
          } },
          { key: "review", header: "Verification", render: task => <VerificationCell task={task} /> },
          { key: "actions", header: "Actions", render: task => <div className="wx-location-tab-row-actions">
            {task.verificationVersion === 2 && !task.staffSubmittedAt && !["COMPLETED", "CANCELLED"].includes(task.status) ? <Button className="wx-location-tab-button" variant="outline" aria-expanded={qrTaskId === task.id} onClick={() => setQrTaskId(qrTaskId === task.id ? null : task.id)}>{t("Task QR")}</Button> : null}
            {task.verificationVersion === 2 ? <Link className="wx-location-tab-button wx-location-tab-button--link"
              to={"/verification/" + task.id + "?returnTo=" + encodeURIComponent("/locations/" + id + "?" + searchParams.toString())}>{t("View task photos")}</Link> :
              task.proofImageUrls?.map((url, i) => <a className="wx-location-tab-button wx-location-tab-button--link" key={url} href={url} target="_blank" rel="noopener noreferrer">{t("View task photos")} {i + 1}</a>)}
            <Button className="wx-location-tab-button wx-location-tab-button--link" variant="ghost" aria-expanded={expandedInstanceId === task.id}
              onClick={() => setExpandedInstanceId(expandedInstanceId === task.id ? null : task.id)}>
              {expandedInstanceId === task.id ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}{t("Areas")}
            </Button>
          </div> },
        ]} />
    </section>
  );
}
