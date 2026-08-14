import { useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw, ShieldCheck, X } from "lucide-react";
import type { RootState } from "@/store/store";
import { client } from "@/api/client";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useLanguage } from "@/i18n/context";
import PageHeader from "@/components/common/PageHeader";
import EmptyState from "@/components/common/EmptyState";
import DataTable from "@/components/common/DataTable";
import ScopeFilters from "@/components/common/ScopeFilters";
import Pagination from "@/components/common/Pagination";
import OperationStatus from "@/components/common/OperationStatus";
import TaskWorker from "@/components/common/TaskWorker";
import WorkspaceTabs, { WorkspaceTabPanel } from "@/components/workspace/WorkspaceTabs";
import ChipGroup from "@/components/workspace/ChipGroup";
import FindField from "@/components/workspace/FindField";
import PersonAvatar from "@/components/workspace/PersonAvatar";
import SiteAvatar from "@/components/workspace/SiteAvatar";
import TaskQr from "../Task/components/TaskQr";
import { taskAssignee } from "../Task/taskAssignee";
import { exceptionStateLabel, verificationLabel, type VerificationSummary } from "../Verification/presentation";
import TodayPulse, { TodayAside } from "./TodayPulse";
import WorkThroughDay from "./WorkThroughDay";
import ByLocationList from "./ByLocationList";
import OperationsState from "./OperationsState";
import {
  useOperations, scopeParams, dailyLink, workLabel, localTime,
  type OperationsPage, type OperationTask, type OperationStaff, type OperationOverview,
} from "./operations";
import "./today-v6.css";

type TodayStaffRow = OperationStaff & { offToday?: boolean };

function Assignee({ task }: { task: OperationTask }) {
  const { t } = useLanguage();
  const { worker } = taskAssignee(task);
  return <div className={`wx-today-person ${task.staffId == null ? "wx-today-person--unassigned" : ""}`}>
    <PersonAvatar name={task.staffId == null ? null : worker?.name} size="small" />
    <div>{task.staffId == null && worker ? <strong>{t("Unassigned")}</strong> : null}<TaskWorker task={task} /></div>
  </div>;
}

function ReviewStatus({ task }: { task: OperationTask }) {
  const review = task.verificationException;
  return <OperationStatus
    state={review?.state === "RESOLVED" ? "RESOLVED" : review ? "NEEDS_REVIEW" : task.completionOutcome === "VERIFIED_COMPLETE" ? "VERIFIED" : task.verificationState}
    label={review?.state === "RESOLVED" ? "Review closed" : review ? exceptionStateLabel(review.state) : task.staffSubmittedAt || task.status === "COMPLETED" ? verificationLabel(task) : "Not submitted"}
  />;
}

function WorkStatus({ task, asOf }: { task: OperationTask; asOf: string }) {
  const submitted = !!task.staffSubmittedAt || task.status === "COMPLETED";
  const overdue = !submitted && task.status !== "CANCELLED" && Date.parse(task.shiftEnd) < Date.parse(asOf);
  return <OperationStatus state={submitted ? "SUBMITTED" : overdue ? "NOT_COMPLETED_INTIME" : task.rawStatus}
    label={overdue ? "Overdue" : workLabel(task)} />;
}

/** Inline details leave the register usable; focus enters the heading and returns on close. */
function TaskPanel({ id, asOf, close }: { id: number; asOf: string; close: () => void }) {
  const { t, language } = useLanguage();
  const heading = useRef<HTMLHeadingElement>(null);
  const actorScope = useSelector((s: RootState) => `${s.auth.user?.companyId}:${s.auth.user?.role}:${s.auth.user?.id}`);
  const query = useQuery({
    queryKey: ["verification-task", actorScope, id],
    queryFn: async ({ signal }) => (await client.get<{ data: OperationTask & VerificationSummary }>(`/task-instance/${id}`, { signal })).data.data,
  });
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView?.({ block: "nearest" });
  }, [id]);
  const task = query.data;
  const submitted = !!task?.staffSubmittedAt || task?.status === "COMPLETED";
  const verified = task?.completionOutcome === "VERIFIED_COMPLETE" || (!task?.completionOutcome && task?.verificationState === "VERIFIED");
  const review = task?.verificationException;
  return <section className="wx-today-task-panel" aria-labelledby="today-task-details" onKeyDown={event => {
    if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); close(); }
  }}>
    <header className="wx-today-panel-heading">
      <h2 id="today-task-details" ref={heading} tabIndex={-1}>{t("Task details")}</h2>
      <button className="wx-today-button wx-today-icon-button" type="button" onClick={close} aria-label={t("Close details")}><X size={18} aria-hidden="true" /></button>
    </header>
    <div className="wx-today-panel-body">
      <OperationsState loading={query.isPending} error={query.error} retry={() => void query.refetch()} layout="task-summary" />
      {task ? <>
        <div><h3><bdi>{task.areaNameSnapshot ?? task.title}</bdi></h3><p>{t("Task")}: <bdi>{task.title}</bdi></p>
          <div className="wx-today-site"><SiteAvatar name={task.location?.name} size="small" /><bdi>{task.location?.name}</bdi></div>
          <p><bdi>{task.location ? localTime(task.shiftStart, task.location.timezone, language, true) : task.shiftStart} – {task.location ? localTime(task.shiftEnd, task.location.timezone, language) : task.shiftEnd}</bdi></p>
          {task.carryOver ? <small>{t("Started yesterday · overnight shift")}</small> : null}
        </div>
        <div><p className="wx-today-field-label">{t("Assigned to")}</p><Assignee task={task} /></div>
        <dl className="wx-today-states">
          <div><dt>{t("Work status")}</dt><dd><WorkStatus task={task} asOf={asOf} /></dd></div>
          <div><dt>{t("Submitted")}</dt><dd><OperationStatus state={submitted ? "SUBMITTED" : "PENDING"} label={submitted ? "Work submitted" : "Not submitted"} />
            {task.staffSubmittedAt && task.location ? <time dateTime={task.staffSubmittedAt}><bdi>{localTime(task.staffSubmittedAt, task.location.timezone, language, true)}</bdi></time> : null}</dd></div>
          <div><dt>{t("Verified")}</dt><dd><OperationStatus state={verified ? "VERIFIED" : "PENDING"} label={verified ? "Verified completion recorded" : task.completionOutcome === "COMPLETED_WITH_EXCEPTIONS" ? "Accepted with exceptions" : "Verified completion not recorded"} />
            <small>{t(verificationLabel(task))}</small></dd></div>
          <div><dt>{t("Review status")}</dt><dd><OperationStatus state={review && review.state !== "RESOLVED" ? "NEEDS_REVIEW" : "PENDING"} label={review?.state === "RESOLVED" ? "Review closed" : review ? exceptionStateLabel(review.state) : "No reviews yet"} /></dd></div>
        </dl>
        <div className="wx-today-panel-actions">
          <Link className="wx-today-button wx-today-button--primary" to={`/verification/${task.id}`}>{t("View task photos")}</Link>
          {task.verificationVersion === 2 && !task.staffSubmittedAt && !["COMPLETED", "CANCELLED"].includes(task.status) ? <TaskQr taskId={task.id} /> : null}
          {review ? <Link className="wx-today-button" to={`/exceptions/${review.id}`}>{t("Review")}</Link> : null}
          {task.templateId ? <Link className="wx-today-button" to={`/locations/${task.locationId}?tab=templates#schedule-${task.templateId}`}>{t("Open cleaning schedule")}</Link> : null}
          <button className="wx-today-button" type="button" onClick={close}>{t("Close")}</button>
        </div>
      </> : null}
    </div>
  </section>;
}

// Calendar arithmetic uses UTC only as a container for location-local date fields.
function adjacentDay(date: string, offset: number) {
  const value = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value.valueOf()) || value.toISOString().slice(0, 10) !== date) return null;
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

export default function TodayStatusPage() {
  const { t, language } = useLanguage();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { hash, key: navigationKey } = useLocation();
  const opener = useRef<HTMLElement | null>(null);
  const records = useRef<HTMLElement>(null);
  useEffect(() => {
    if (hash !== "#daily-records") return;
    const frame = requestAnimationFrame(() => {
      records.current?.scrollIntoView?.({ block: "start", behavior: "instant" });
      records.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [hash, navigationKey]);
  const tab = params.get("tab") === "staff" ? "staff" : "tasks";
  const overview = useOperations<OperationOverview>("overview", scopeParams(params));
  const filters = {
    ...scopeParams(params),
    ...Object.fromEntries(["q", "attendance", "status", "workerId", "page", "pageSize"].map(k => [k, params.get(k) ?? ""]).filter(([, v]) => v)),
  };
  const search = useDebouncedValue(params.get("q") ?? "");
  const appliedFilters = { ...filters, q: search };
  const staff = useOperations<OperationsPage<TodayStaffRow>>("staff", appliedFilters, tab === "staff");
  const tasks = useOperations<OperationsPage<OperationTask>>("tasks", appliedFilters, tab === "tasks");
  const query = tab === "staff" ? staff : tasks;
  const data = query.data;
  function update(key: string, value: string) {
    setParams(old => {
      const next = new URLSearchParams(old);
      if (value) next.set(key, value); else next.delete(key);
      if (key !== "page" && key !== "taskId") next.delete("page");
      if (key === "date") next.delete("taskId");
      return next;
    });
  }
  useEffect(() => {
    if (data && params.get("page") && Number(params.get("page")) !== data.page) {
      setParams(old => { const next = new URLSearchParams(old); next.set("page", String(data.page)); return next; }, { replace: true });
    }
  }, [data, params, setParams]);
  function taskDestination(id: number) {
    return dailyLink(params, { ...Object.fromEntries(params), tab: "tasks", taskId: String(id) });
  }
  function openTask(id: number) {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active.matches("tr[tabindex]")
      ? active
      : records.current?.querySelector<HTMLElement>(`[data-task-opener="${id}"]`) ?? null;
    navigate(taskDestination(id), { preventScrollReset: true });
  }
  function closeTask() {
    update("taskId", "");
    requestAnimationFrame(() => {
      const fallback = document.querySelector<HTMLElement>(`a[data-task-opener="${taskId}"]`);
      const target = opener.current?.isConnected ? opener.current : fallback ?? records.current;
      target?.focus({ preventScroll: true });
      opener.current = null;
    });
  }
  const summary = overview.data;
  const days = summary?.days ?? [];
  const sharedLocalDate = days.length && new Set(days.map(day => day.localDate)).size === 1 ? days[0].localDate : undefined;
  // The API orders the authorized scope. All-location charts use its first
  // location's timezone explicitly; there is no browser-clock rebucketing.
  const timezone = summary?.selected?.[0]?.timezone ?? days[0]?.timezone ?? "UTC";
  let currentLocalDate: string | undefined;
  if (summary && Number.isFinite(Date.parse(summary.asOf))) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(summary.asOf));
    currentLocalDate = ["year", "month", "day"].map(key => parts.find(part => part.type === key)?.value).join("-");
  }
  const date = params.get("date") || "today";
  const selectedDay = date === "today" ? sharedLocalDate ?? currentLocalDate : adjacentDay(date, 0) ?? undefined;
  const previousDay = selectedDay ? adjacentDay(selectedDay, -1) : null;
  const nextDay = selectedDay ? adjacentDay(selectedDay, 1) : null;
  const dateLabel = selectedDay ? new Intl.DateTimeFormat(language === "ur" ? "ur-PK" : "en-PK", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${selectedDay}T12:00:00Z`)) : t("Today in each location");
  const taskId = Number(params.get("taskId"));
  const hasTask = Number.isSafeInteger(taskId) && taskId > 0;
  const counts = summary?.chart;
  const taskOptions = [
    { value: "all", label: "All tasks", count: summary?.metrics.totalTasks },
    { value: "overdue", label: "Overdue", count: counts?.overdue },
    { value: "unassigned", label: "Unassigned work" },
    { value: "in-progress", label: "In progress", count: counts?.inProgress },
    { value: "not-started", label: "Not started", count: counts?.notStarted },
    { value: "submitted", label: "Work submitted", count: counts?.submitted },
  ];
  const attendanceOptions = [
    { value: "all", label: "All staff" }, { value: "present", label: "Present" },
    { value: "absent", label: "Not checked in" }, { value: "upcoming", label: "Shift not started" },
    { value: "missing", label: "No attendance record" },
    { value: "off", label: "Day off" },
  ];
  const refresh = () => { void query.refetch(); void overview.refetch(); };
  const number = (value: number) => value.toLocaleString(language === "ur" ? "ur-PK" : "en-PK");
  const emptyScope = summary && summary.locations.length === 0;
  const renderRecords = () => <>
    <div className="wx-today-toolbar">
      <FindField label={tab === "staff" ? "Search staff" : "Find a task"} placeholder="Search name, room or task" value={params.get("q") ?? ""} onChange={value => update("q", value)} />
      <ChipGroup label={tab === "staff" ? "Attendance" : "Task status"} value={params.get(tab === "staff" ? "attendance" : "status") ?? "all"} options={tab === "staff" ? attendanceOptions : taskOptions} onChange={value => update(tab === "staff" ? "attendance" : "status", value)} />
    </div>
    <OperationsState loading={query.isPending} layout="today-table" error={query.error} retry={() => void query.refetch()} />
    {data ? <>
      {data.total === 0 ? <EmptyState title={emptyScope ? "Nothing is scheduled yet" : "Nothing here yet."} message={emptyScope ? "Today fills up on its own once a location has staff, shifts and a cleaning schedule." : tab === "tasks" ? "No tasks match these filters." : "No workers match these filters."}
        action={emptyScope ? <Link className="wx-today-button wx-today-button--primary" to="/setup">{t("Continue setup")}</Link> : <button className="wx-today-button wx-today-button--primary" type="button" onClick={() => setParams(new URLSearchParams(scopeParams(params)).toString() + (tab === "staff" ? "&tab=staff" : ""))}>{t("Clear filters")}</button>} /> : tab === "staff" ? <DataTable mobileCards data={staff.data?.rows ?? []} rowKey={r => r.id} emptyMessage="No workers match these filters." columns={[
        { key: "staff", header: "Worker", render: r => <div className="wx-today-person"><PersonAvatar name={r.name} /><strong><bdi>{r.name}</bdi></strong></div> },
        { key: "shift", header: "Location and shift", render: r => <div><div className="wx-today-site"><SiteAvatar name={r.location.name} size="small" /><bdi>{r.location.name}</bdi></div><p><bdi>{r.attendance ? `${localTime(r.attendance.expectedStart, r.location.timezone, language)} – ${localTime(r.attendance.expectedEnd, r.location.timezone, language)}` : t("No attendance record")}</bdi></p>{r.carryOver ? <small>{t("Started yesterday · overnight shift")}</small> : null}</div> },
        { key: "checkin", header: "Check-in", render: r => {
          if (r.offToday && !r.attendance) return null;
          return r.attendance?.checkInTime ? <time dateTime={r.attendance.checkInTime}><bdi>{localTime(r.attendance.checkInTime, r.location.timezone, language)}</bdi></time> : t("Not recorded");
        } },
        { key: "attendance", header: "Attendance", render: r => {
          if (r.offToday && !r.attendance) return <OperationStatus label="Day off" />;
          return <OperationStatus state={r.attendance?.checkOutTime ? "CHECKED_OUT" : r.attendance?.checkInTime ? r.attendance.status : r.attendance?.status === "ABSENT" && Date.parse(r.attendance.expectedStart) <= Date.parse(data.asOf) ? "ABSENT" : "PENDING"}
            label={r.attendance?.checkInTime ? r.attendance.checkOutTime ? "Checked out" : r.attendance.status === "LATE" ? "Late check-in" : r.attendance.status === "MISSED_CHECKOUT" ? "Missed checkout" : "Present" : r.attendance?.status === "ABSENT" ? Date.parse(r.attendance.expectedStart) > Date.parse(data.asOf) ? "Shift not started" : "Not checked in" : "No attendance record"} />;
        } },
        { key: "progress", header: "Current work", render: r => <div>{r.tasks.filter(task => task.status === "IN_PROGRESS" && !task.staffSubmittedAt).map(task => <Link className="wx-today-work-link" key={task.id} to={taskDestination(task.id)} onClick={event => { opener.current = event.currentTarget; }} preventScrollReset><bdi>{task.areaNameSnapshot ?? task.title}</bdi></Link>)}<p>{t("Work submitted")}: <bdi>{number(r.submittedCount)} / {number(r.taskCount)}</bdi></p></div> },
        { key: "action", header: "Next action", className: "wx-today-worker-action", render: r => <Link className="wx-today-button" to={`/staff/${r.id}?dateFrom=${r.localDate}&dateTo=${r.localDate}&tab=overview&focus=today`}>{t("View worker")}</Link> },
      ]} /> : <DataTable mobileCards data={tasks.data?.rows ?? []} rowKey={r => r.id} onRowClick={r => openTask(r.id)} selectedRowKey={hasTask ? taskId : null} emptyMessage="No tasks match these filters." columns={[
        { key: "time", header: "Time", render: r => <div><bdi>{localTime(r.shiftStart, r.location.timezone, language)} – {localTime(r.shiftEnd, r.location.timezone, language)}</bdi>{r.carryOver ? <small>{t("Started yesterday · overnight shift")}</small> : null}</div> },
        { key: "task", header: "Area / task", render: r => <div><strong><bdi>{r.areaNameSnapshot ?? r.title}</bdi></strong><p><bdi>{r.title}</bdi> · <bdi>{r.location.name}</bdi></p></div> },
        { key: "worker", header: "Assigned to", render: r => <Assignee task={r} /> },
        { key: "status", header: "Work status", render: r => <WorkStatus task={r} asOf={data.asOf} /> },
        { key: "review", header: "Review status", render: r => <ReviewStatus task={r} /> },
        { key: "action", header: "Next action", render: r => <Link className="wx-today-button wx-today-icon-button" data-task-opener={r.id} to={taskDestination(r.id)} onClick={event => { opener.current = event.currentTarget; }} preventScrollReset aria-label={`${t("Open task")}: ${r.areaNameSnapshot ?? r.title}`}><ChevronRight size={18} className="wx-today-direction" aria-hidden="true" /></Link> },
      ]} />}
      <Pagination page={data.page} totalPages={data.totalPages} pageSize={data.pageSize} total={data.total} onPage={p => update("page", String(p))} onSize={p => update("pageSize", String(p))} />
    </> : null}
  </>;
  return <div className="wx-today">
    <PageHeader title={date !== "today" ? "Daily records" : "Today, at a glance"} subtitle={t("Your team, the work in motion, and what needs attention.")} tools={<>
      <div className="wx-today-day-nav" role="group" aria-label={t("Date")}>
        <button type="button" className="wx-today-button wx-today-icon-button" aria-label={t("Previous day")} disabled={!previousDay} onClick={() => previousDay && update("date", previousDay)}><ChevronLeft className="wx-today-direction" size={18} aria-hidden="true" /></button>
        <button type="button" className="wx-today-button" onClick={() => update("date", "today")}>{t("Today")}</button>
        <button type="button" className="wx-today-button wx-today-icon-button" aria-label={t("Next day")} disabled={!nextDay || !currentLocalDate || nextDay > currentLocalDate} onClick={() => nextDay && update("date", nextDay)}><ChevronRight className="wx-today-direction" size={18} aria-hidden="true" /></button>
      </div>
      <ScopeFilters localDate={currentLocalDate} locations={data?.locations ?? summary?.locations ?? []} />
    </>} />
    <p className="wx-today-date"><bdi>{dateLabel}</bdi></p>
    <OperationsState loading={overview.isPending} error={overview.error} retry={() => void overview.refetch()} layout="today-summary" />
    {summary ? <>
      <TodayPulse data={summary} params={params} />
      <div className="wx-today-charts"><WorkThroughDay hourly={summary.hourly} asOf={summary.asOf} date={date} timezone={timezone} /><ByLocationList comparison={summary.comparison} params={params} /></div>
    </> : null}
    <div className={`wx-today-register-layout ${hasTask ? "wx-today-register-layout--details" : ""}`}>
      <section className="wx-today-register" id="daily-records" ref={records} tabIndex={-1} aria-label={t("Daily records")}>
        <div className="wx-today-register-heading"><h2>{t(tab === "tasks" ? "Today’s tasks" : "Staff")}</h2>
          <div>{data ? <span>{t("Updated {time}", { time: localTime(data.asOf, timezone, language) })}</span> : null}<button className="wx-today-button" type="button" disabled={query.isFetching || overview.isFetching} aria-busy={query.isFetching || overview.isFetching} onClick={refresh}><RefreshCw size={16} aria-hidden="true" />{t("Refresh")}</button></div>
        </div>
        <WorkspaceTabs label="Daily records" value={tab} onChange={value => navigate(dailyLink(params, { tab: value }), { preventScrollReset: true })} tabs={[{ value: "tasks", label: "Tasks", count: tab === "tasks" ? data?.total : undefined }, { value: "staff", label: "Staff", count: tab === "staff" ? data?.total : undefined }]}>
          <WorkspaceTabPanel value="tasks">{tab === "tasks" ? renderRecords() : null}</WorkspaceTabPanel>
          <WorkspaceTabPanel value="staff">{tab === "staff" ? renderRecords() : null}</WorkspaceTabPanel>
        </WorkspaceTabs>
      </section>
      {hasTask ? <TaskPanel key={taskId} id={taskId} asOf={data?.asOf ?? summary?.asOf ?? ""} close={closeTask} /> : null}
    </div>
    {summary ? <TodayAside data={summary} params={params} /> : null}
    <p className="wx-today-footnote"><ShieldCheck size={16} aria-hidden="true" />{t("Task submission and verified completion are recorded separately.")}</p>
  </div>;
}
