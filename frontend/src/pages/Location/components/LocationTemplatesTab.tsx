import { useLocationLanguage } from "../locationTranslations";
import { SidePanel, SidePanelFooter } from "@/components/workspace/SidePanel";
import { WeekdayPicker } from "@/components/workspace/WeekdayPicker";
import { formatDays, isEveryDay, normalizeDays, WEEKDAYS, WEEKDAY_LABELS, type Weekday } from "@/lib/workDays";
import { moveWeek, normalizeWeek } from "../scheduleTypes";
import "@/pages/Task/schedule-v6.css";
import { useSetupFormText } from "@/pages/Area/areaFormText";
import TemplateInventoryEditor from "@/pages/Area/TemplateInventoryEditor";
import { useAreas } from "@/pages/Area/queries";
import { useLocation, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";
import {
  useDeleteTaskTemplate,
  useEditTaskTemplate,
} from "@/pages/Task/queries";
import { useAssignStaffToTemplate } from "@/pages/Assignment/queries";
import type { EditTaskTemplateInput } from "@/pages/Task/api";
import type { LocationStaff, TaskTemplate } from "../types";
import { buildDateTimeIso, emptyRepeatDaysMessage, type RecurrenceChoice } from "@/pages/Task/taskScheduleForm";
import TaskScheduleWizard, { SchedulePlanFeatures, translateScheduleWorkerError } from "@/pages/Task/components/TaskScheduleWizard";

import {
  buildDayAgenda,
  buildScheduleCoverage,
  buildScheduleDetails,
  buildScheduleList,
  buildStaffWeek,
  type ScheduleFilters,
  type ScheduleGroupBy,
} from "../schedulePageModel";
import { ScheduleCoverageRow } from "./schedule-page/ScheduleCoverageRow";
import { ScheduleToolbar } from "./schedule-page/ScheduleToolbar";
import { ScheduleList } from "./schedule-page/ScheduleList";
import { ScheduleStaffWeek } from "./schedule-page/ScheduleStaffWeek";
import { ScheduleDetailsPanel } from "./schedule-page/ScheduleDetailsPanel";
import "./schedule-page/schedule-page.css";

const exampleDays = ["MON", "WED", "FRI"] as const;

function dateForLabel(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

function hasChosenRepeatDays(template: TaskTemplate) {
  return template.recurringType === "DAILY" && !!template.repeatDays?.length && !isEveryDay(template.repeatDays);
}

export default function LocationTemplatesTab({
  templates,
  staffList,
  locationId,
  timeZone,
  locationName,
}: {
  templates: TaskTemplate[];
  staffList: LocationStaff[];
  locationId: number;
  timeZone: string;
  locationName: string;
}) {
  const { t: translate,language } = useLocationLanguage();
  const formText = useSetupFormText();
  const [saving,setSaving]=useState(false);
  const [assignmentRetry,setAssignmentRetry]=useState(false);
  const inFlight=useRef(false);
  const { hash } = useLocation();
  const [selection, setSelection] = useState<{ hash: string; id: number | null }>();
  const linkedId = /^#schedule-([1-9]\d*)$/.exec(hash)?.[1];
  const selectedId = selection?.hash === hash ? selection.id : linkedId ? Number(linkedId) : null;
  const selectedTemplate = templates.find(template => template.id === selectedId);
  const detailsOpener = useRef<HTMLElement | null>(null);
  const editReturnFocus = useRef<HTMLElement | null>(null);
  const [search, setSearch] = useState("");
  const [staffFilter, setStaffFilter] = useState<ScheduleFilters["staff"]>();
  const [areaFilter, setAreaFilter] = useState<ScheduleFilters["areaId"]>();
  const [groupBy, setGroupBy] = useState<ScheduleGroupBy>("time");
  const [chip, setChip] = useState<NonNullable<ScheduleFilters["chip"]>>("all");
  const [selectedWeekday, setSelectedWeekday] = useState<Weekday | null>(null);
  const [agendaSelection, setAgendaSelection] = useState<{ week: string; weekday: Weekday }>();
  const areasQuery = useAreas(locationId);
  const deleteTemplate = useDeleteTaskTemplate();
  const editTemplate = useEditTaskTemplate();
  const assignStaff = useAssignStaffToTemplate();
  const [editingTemplate, setEditingTemplate] = useState<TaskTemplate | null>(
    null,
  );
  useEffect(() => {
    if (!editingTemplate && editReturnFocus.current) {
      editReturnFocus.current.focus();
      editReturnFocus.current = null;
    }
  }, [editingTemplate]);
  const [dateTouched, setDateTouched] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [workerError, setWorkerError] = useState<ReturnType<typeof translateScheduleWorkerError>>();
  const [repeatError, setRepeatError] = useState<string | null>(null);
  const [params,setParams]=useSearchParams();
  const createDialogOpen=params.get('newSchedule')==='1';
  const setCreateDialogOpen=(open:boolean)=>setParams(previous=>{const result=new URLSearchParams(previous);if(open)result.set('newSchedule','1');else result.delete('newSchedule');return result;},{replace:true});
  const [editForm, setEditForm] = useState({
    title: "",
    description: "",
    staffId: "" as string,
    shiftStart: "",
    shiftEnd: "",
    recurringType: "" as RecurrenceChoice | "",
    repeatDays: [...WEEKDAYS],
    effectiveDate: "",
  });
  const todayDate = formatInTimeZone(new Date(),timeZone,'yyyy-MM-dd');

  const toTimeValue = (iso?: string | null) => {
    if (!iso) return "";
    return formatInTimeZone(new Date(iso), timeZone, "HH:mm");
  };

  const toDateValue = (iso?: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  };

  const wallTimeToIso = (base: string | null, timeValue: string) => {
    const datePart = formatInTimeZone(
      base ? new Date(base) : new Date(),
      timeZone,
      "yyyy-MM-dd",
    );
    return buildDateTimeIso(timeZone, datePart, timeValue);
  };

  const handleEditOpen = (t: TaskTemplate) => {
    const usesChosenDays = hasChosenRepeatDays(t);
    setEditError(null);setRepeatError(null);setAssignmentRetry(false);setDateTouched(false);
    setWorkerError(undefined);
    setEditingTemplate(t);
    setEditForm({
      title: t.title,
      description: t.description || "",
      staffId: t.staffId ? String(t.staffId) : "",
      shiftStart: toTimeValue(t.shiftStart),
      shiftEnd: toTimeValue(t.shiftEnd),
      recurringType: usesChosenDays ? "CHOSEN" : t.recurringType ?? "",
      repeatDays: normalizeDays(usesChosenDays ? t.repeatDays : undefined),
      effectiveDate: toDateValue(t.effectiveDate),
    });
  };

  const chosenDays = editForm.recurringType === "CHOSEN";
  const staffError = workerError?.field === "staffId" ? workerError.message : null;
  const shiftError = workerError?.field === "shiftStart" ? workerError.message : null;
  const repeatErrorId = repeatError ? "edit-schedule-repeat-error" : undefined;
  const repeatErrorText = repeatError && <p id={repeatErrorId} role="alert" className="wx-schedule-error">{repeatError}</p>;
  const dateInvalid = !!editForm.effectiveDate && editForm.effectiveDate !== toDateValue(editingTemplate?.effectiveDate) && editForm.effectiveDate < todayDate;
  const handleEditSave = async () => {
    if (dateInvalid) { setDateTouched(true); return; }
    if (!editingTemplate || inFlight.current) return;
    setWorkerError(undefined);
    if (chosenDays && !editForm.repeatDays.length) {
      setEditError(null);
      setRepeatError(translate(emptyRepeatDaysMessage));
      return;
    }
    inFlight.current=true;setSaving(true);
    setEditError(null);
    setRepeatError(null);

    const payload: EditTaskTemplateInput & { repeatDays?: Weekday[] } = {};
    if (editForm.title !== editingTemplate.title)
      payload.title = editForm.title;
    if (editForm.description !== (editingTemplate.description || ""))
      payload.description = editForm.description || undefined;
    const recurringType = editForm.recurringType === "CHOSEN" ? "DAILY" : editForm.recurringType;
    if (recurringType && recurringType !== editingTemplate.recurringType) {
      payload.recurringType = recurringType;
    }
    if (recurringType === "DAILY") {
      const repeatDays = chosenDays ? editForm.repeatDays : WEEKDAYS;
      const savedDays = normalizeDays(hasChosenRepeatDays(editingTemplate) ? editingTemplate.repeatDays : undefined);
      if (repeatDays.length !== savedDays.length || repeatDays.some((day, index) => day !== savedDays[index])) {
        payload.recurringType = "DAILY";
        payload.repeatDays = [...repeatDays];
      }
    }
    if (
      editForm.shiftStart &&
      editForm.shiftStart !== toTimeValue(editingTemplate.shiftStart)
    ) {
      payload.shiftStart = wallTimeToIso(
        editingTemplate.shiftStart,
        editForm.shiftStart,
      );
    }
    if (
      editForm.shiftEnd &&
      editForm.shiftEnd !== toTimeValue(editingTemplate.shiftEnd)
    ) {
      payload.shiftEnd = wallTimeToIso(
        editingTemplate.shiftEnd,
        editForm.shiftEnd,
      );
    }
    if (
      editForm.effectiveDate &&
      editForm.effectiveDate !== toDateValue(editingTemplate.effectiveDate)
    ) {
      const [year, month, day] = editForm.effectiveDate.split("-").map(Number);
      payload.effectiveDate = new Date(
        Date.UTC(year, month - 1, day, 0, 0, 0),
      ).toISOString();
    }

    const staffChanged =
      editForm.staffId !== String(editingTemplate.staffId ?? "");
    const hasFieldChanges = Object.keys(payload).length > 0;
    let fieldsSaved=false;
    let assignmentAttempted=false;

    try {
      if (hasFieldChanges) {
        await new Promise<void>((resolve, reject) => {
          editTemplate.mutate(
            { id: editingTemplate.id, data: payload },
            { onSuccess: () => resolve(), onError: (err) => reject(err) },
          );
        });
        fieldsSaved=true;
        setEditingTemplate({
          ...editingTemplate,
          ...payload,
          repeatDays: payload.recurringType === "ONCE" ? undefined : payload.repeatDays ?? editingTemplate.repeatDays,
        });
      }

      if (staffChanged && editForm.staffId) {
        assignmentAttempted=true;
        await new Promise<void>((resolve, reject) => {
          assignStaff.mutate(
            {
              templateId: editingTemplate.id,
              staffId: Number(editForm.staffId),
            },
            { onSuccess: () => resolve(), onError: (err) => reject(err) },
          );
        });
      }

      setEditingTemplate(null);
    } catch (error) {
      setAssignmentRetry(assignmentAttempted);
      const staffId = assignmentAttempted ? Number(editForm.staffId) : editingTemplate.staffId;
      const worker = staffList.find(staff => staff.id === staffId);
      const name = worker?.name ?? (assignmentAttempted ? undefined : editingTemplate.staff?.name);
      const refusal = translateScheduleWorkerError(error, formText, name);
      if (refusal) {
        setWorkerError(refusal);
        if (!fieldsSaved || !assignmentAttempted) return;
      }
      const response = (error as { response?: { status?: number; data?: { errors?: { code?: string }[] } } } | null)?.response;
      const code = response?.data?.errors?.[0]?.code;
      if (response?.status === 400 && code === "INVALID_REPEAT_DAYS") {
        setRepeatError(translate(emptyRepeatDaysMessage));
        return;
      }
      if (response?.status === 422 && code === "SCHEDULE_OUTSIDE_WORK_DAYS") {
        const days = worker?.workDays?.length ? worker.workDays : undefined;
        setRepeatError(name
          ? translate("{name} works {days}. Choose days within those, or use automatic assignment.", {
            name,
            days: formatDays(days, translate, language),
          })
          : formText("Could not save the schedule. Check the fields and try again."));
        if (!fieldsSaved || !assignmentAttempted) return;
      }
      setEditError(translate(fieldsSaved&&staffChanged
       ? 'Schedule details were saved. Staff assignment could not be confirmed. Your draft is kept. Review the assignment before retrying.'
       : staffChanged&&!hasFieldChanges
        ? 'Staff assignment could not be confirmed. Your draft is kept. Review the assignment before retrying.'
        : 'The schedule could not be saved. Your draft is kept. Refresh the saved schedule before trying again.'));
    } finally {inFlight.current=false;setSaving(false);}
  };

  const inputCls = "wx-schedule-input";
  const formLabelCls = "wx-schedule-label";
  const week = normalizeWeek(params.get('week')) ?? normalizeWeek(todayDate)!;
  const changeWeek = (nextWeek?: string) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (nextWeek) next.set('week', nextWeek); else next.delete('week');
    return next;
  });

  const view = params.get("view") === "week" ? "week" : "list";
  const [renderedView, setRenderedView] = useState({ view, animate: false });
  if (renderedView.view !== view) setRenderedView({ view, animate: true });
  const changeView = (nextView: "list" | "week") => {
    if (nextView === view) return;
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (nextView === "week") next.set("view", "week"); else next.delete("view");
      return next;
    });
  };

  const areas = areasQuery.data;
  const context = useMemo(() => ({ timeZone, today: todayDate, areas }), [timeZone, todayDate, areas]);
  const list = useMemo(() => {
    const filters = { search, staff: staffFilter, areaId: areaFilter };
    return buildScheduleList(templates, staffList, context, view === "list"
      ? { ...filters, chip, weekday: selectedWeekday ?? undefined }
      : filters, view === "list" ? groupBy : "time");
  }, [templates, staffList, context, search, staffFilter, areaFilter, view, chip, selectedWeekday, groupBy]);
  const coverage = useMemo(() => templates.length ? buildScheduleCoverage(templates, staffList, context, week) : [],
    [templates, staffList, context, week]);
  const locale = language === "ur" ? "ur-PK" : "en-GB";
  const weekLabel = useMemo(() => {
    if (!coverage.length) return "";
    return new Intl.DateTimeFormat(locale, {
      day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
    }).formatRange(dateForLabel(coverage[0].date), dateForLabel(coverage[coverage.length - 1].date));
  }, [coverage, locale]);

  const agendaWeekday = agendaSelection?.week === week ? agendaSelection.weekday : null;
  const agendaDay = coverage.find(day => day.weekday === agendaWeekday)
    ?? coverage.find(day => day.isToday) ?? coverage[0];
  const weekView = useMemo(() => {
    if (view !== "week" || !agendaDay) return null;
    const dayFormat = new Intl.DateTimeFormat(locale, {
      weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
    });
    const matchingIds = new Set(list.groups.flatMap(group => group.rows.map(row => row.id)));
    const matchingTemplates = templates.filter(template => matchingIds.has(template.id));
    const rows = buildStaffWeek(matchingTemplates, staffList, context, week);
    return {
      rows: staffFilter === undefined ? rows : rows.filter(row => (row.worker?.id ?? "unassigned") === staffFilter),
      days: coverage.map(day => ({ ...day, label: dayFormat.format(dateForLabel(day.date)) })),
      agenda: buildDayAgenda(matchingTemplates, staffList, context, agendaDay.date),
      agendaLabel: dayFormat.format(dateForLabel(agendaDay.date)),
    };
  }, [view, agendaDay, list.groups, templates, staffList, context, week, staffFilter, coverage, locale]);

  const unassignedCount = templates.filter(template => template.staffId == null).length;
  const clearFilters = () => {
    setSearch("");
    setStaffFilter(undefined);
    setAreaFilter(undefined);
    setChip("all");
    setSelectedWeekday(null);
  };
  const openDetails = (id: number) => {
    detailsOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelection({ hash, id });
  };
  const closeDetails = () => setSelection({ hash, id: null });

  return (
    <section className="schedule-page" aria-label={translate("Cleaning schedules")}>
      <header className="schedule-page__header">
        <div>
          <h2>{translate("Cleaning schedules")}</h2>
          <p className="schedule-page__summary">
            {templates.length > 0 && <>{translate("{count} schedules", { count: templates.length })} · </>}
            {translate("{count} staff at this location", { count: staffList.length })}
            {unassignedCount > 0 && <>
              {" · "}
              <button type="button" className="schedule-page__attention" onClick={() => {
                setChip("needsAttention");
                changeView("list");
              }}>
                {translate("{count} need a worker", { count: unassignedCount })}
              </button>
            </>}
          </p>
        </div>
        {templates.length > 0 && (
          <Button type="button" className="schedule-page__add schedule-page__primary"
            aria-label={translate("Add cleaning schedule")} onClick={() => setCreateDialogOpen(true)}>
            <Plus aria-hidden="true" />
            <span>{translate("Add cleaning schedule")}</span>
          </Button>
        )}
      </header>
      {createDialogOpen && (
        <TaskScheduleWizard
          locationId={locationId}
          locationName={locationName}
          timeZone={timeZone}
          staffOptions={staffList}
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onCreated={() => undefined}
        />
      )}

      {templates.length > 0 ? <>
        <ScheduleCoverageRow
          coverage={coverage}
          weekLabel={weekLabel}
          selectedWeekday={view === "list" ? selectedWeekday : agendaWeekday}
          onChooseDay={weekday => {
            if (view === "week") setAgendaSelection({ week, weekday });
            else setSelectedWeekday(previous => previous === weekday ? null : weekday);
          }}
          onPreviousWeek={() => changeWeek(moveWeek(week, -1))}
          onNextWeek={() => changeWeek(moveWeek(week, 1))}
          onThisWeek={() => changeWeek()}
        />
        <ScheduleToolbar
          view={view}
          search={search}
          staffFilter={staffFilter}
          areaFilter={areaFilter}
          groupBy={groupBy}
          chip={chip}
          selectedWeekday={selectedWeekday}
          counts={list.counts}
          staffOptions={staffList}
          areaOptions={areasQuery.data ?? []}
          onViewChange={changeView}
          onSearchChange={setSearch}
          onStaffFilterChange={setStaffFilter}
          onAreaFilterChange={setAreaFilter}
          onGroupByChange={setGroupBy}
          onChipChange={setChip}
          onClearDay={() => setSelectedWeekday(null)}
        />
        <div key={view} className="schedule-page__view" data-switched={renderedView.animate || undefined}>
          {weekView ? <ScheduleStaffWeek {...weekView} onOpen={openDetails} /> : (
            <ScheduleList groups={list.groups} selectedId={selectedId} onOpen={openDetails} onClearFilters={clearFilters} />
          )}
        </div>
      </> : (
        <div className="schedule-page__empty">
          <div className="schedule-page__tiles" aria-hidden="true">
            {WEEKDAYS.map(day => (
              <span key={day} data-active={exampleDays.some(example => example === day) || undefined}>
                {translate(WEEKDAY_LABELS[day].short).slice(0, 1)}
              </span>
            ))}
          </div>
          <h3>{translate("No cleaning schedules yet")}</h3>
          <p>{translate("A schedule says what gets cleaned, by whom, at what time and on which days. Tasks are then created for each day automatically.")}</p>
          <Button type="button" className="schedule-page__primary" onClick={() => setCreateDialogOpen(true)}>
            <Plus aria-hidden="true" />
            {translate("Add the first schedule")}
          </Button>
        </div>
      )}

      <ScheduleDetailsPanel
        details={selectedTemplate ? buildScheduleDetails(selectedTemplate, staffList, context) : null}
        areaHref={"/locations/" + locationId + "?tab=areas"}
        onClose={closeDetails}
        onEdit={() => {
          if (!selectedTemplate) return;
          editReturnFocus.current = detailsOpener.current;
          closeDetails();
          handleEditOpen(selectedTemplate);
        }}
        deleteDisabled={deleteTemplate.isPending}
        onDelete={async () => {
          if (!selectedTemplate) return;
          await deleteTemplate.mutateAsync(selectedTemplate.id);
          closeDetails();
        }}
      />

      <SidePanel wide title={translate('Edit cleaning schedule')} description={translate('Changes apply to the schedule. Recorded task history stays unchanged.')} open={!!editingTemplate} onOpenChange={open=>{if(!open&&!inFlight.current)setEditingTemplate(null);}} footer={<SidePanelFooter className="wx-schedule-footer"><Button type="button" variant="outline" disabled={saving} onClick={()=>setEditingTemplate(null)}>{translate('Cancel')}</Button><Button type="submit" form="location-schedule-edit" disabled={saving||!editForm.title.trim()} aria-busy={saving}>{translate(saving?'Saving...':assignmentRetry?'Retry staff assignment':'Save changes')}</Button></SidePanelFooter>}>
        {editingTemplate?<div className="wx-schedule-form" aria-busy={saving}><p className="wx-schedule-help"><bdi>{locationName}</bdi> · <bdi>{timeZone}</bdi></p><form id="location-schedule-edit" onChange={()=>{setAssignmentRetry(false);setRepeatError(null);setWorkerError(undefined);}} onSubmit={event=>{event.preventDefault();void handleEditSave();}}><fieldset disabled={saving} className="wx-schedule-stack">

              <div>
                <label htmlFor="schedule-title" className={formLabelCls}>{translate("Schedule title")}</label>
                <input
                  type="text"
                  id="schedule-title" aria-label={translate("Schedule title")}
                  value={editForm.title}
                  onChange={(e) =>
                    setEditForm({ ...editForm, title: e.target.value })
                  }
                  className={inputCls}
                />
              </div>

              <div>
                <label htmlFor="schedule-description" className={formLabelCls}>{translate("Description")}</label>
                <textarea
                  id="schedule-description" aria-label={translate("Description")}
                  value={editForm.description}
                  onChange={(e) =>
                    setEditForm({ ...editForm, description: e.target.value })
                  }
                  rows={2}
                  className={`${inputCls} resize-none`}
                />
              </div>

              <div><label htmlFor="schedule-area" className={formLabelCls}>{translate('Area')}</label><input id="schedule-area" readOnly value={editingTemplate.area?.name ?? areasQuery.data?.find(area => area.id === editingTemplate.areaId)?.name ?? '—'} /><p className="wx-schedule-help">{translate('Changes apply to future tasks. Each generated task keeps its original requirements.')}</p></div>

              <div>
                <label htmlFor="schedule-staff" className={formLabelCls}>{translate("Assigned staff")}</label>
                <select
                  id="schedule-staff" aria-label={translate("Assigned staff")}
                  aria-invalid={staffError ? true : undefined}
                  aria-describedby={staffError ? "edit-schedule-staff-error" : undefined}
                  value={editForm.staffId}
                  onChange={(e) =>
                    setEditForm({ ...editForm, staffId: e.target.value })
                  }
                  className={inputCls}
                >
                  <SchedulePlanFeatures>{requiresWorker => (!requiresWorker || !editingTemplate.staffId) &&
                    <option value="" disabled={!!editingTemplate.staffId}>{translate("Unassigned")}</option>}
                  </SchedulePlanFeatures>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {staffError && <p id="edit-schedule-staff-error" role="alert" className="wx-schedule-error">{staffError}</p>}
              </div>

              <div className="wx-schedule-pair">
                <div>
                  <label htmlFor="schedule-start" className={formLabelCls}>{translate("Shift start")}</label>
                  <Input
                    type="time"
                    id="schedule-start" aria-label={translate("Shift start")}
                    aria-invalid={shiftError ? true : undefined}
                    aria-describedby={shiftError ? "edit-schedule-shift-error" : undefined}
                    value={editForm.shiftStart}
                    onChange={(e) =>
                      setEditForm({ ...editForm, shiftStart: e.target.value })
                    }
                  />
                  {shiftError && <p id="edit-schedule-shift-error" role="alert" className="wx-schedule-error">{shiftError}</p>}
                </div>
                <div>
                  <label htmlFor="schedule-end" className={formLabelCls}>{translate("Shift end")}</label>
                  <Input
                    type="time"
                    id="schedule-end" aria-label={translate("Shift end")}
                    value={editForm.shiftEnd}
                    onChange={(e) =>
                      setEditForm({ ...editForm, shiftEnd: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="wx-schedule-pair">
              <div className="wx-schedule-field">
                <label htmlFor="schedule-recurrence" className={formLabelCls}>{translate("Recurrence")}</label>
                <select
                  id="schedule-recurrence" aria-label={translate("Recurrence")}
                  aria-invalid={!chosenDays && repeatErrorId ? true : undefined}
                  aria-describedby={!chosenDays ? repeatErrorId : undefined}
                  value={editForm.recurringType}
                  onChange={(e) =>
                    setEditForm({ ...editForm, recurringType: e.target.value as RecurrenceChoice | "" })
                  }
                  className={inputCls}
                >
                  <option value="">{translate("Select type")}</option>
                  <option value="DAILY">{translate("Daily")}</option>
                  <option value="CHOSEN">{translate("Chosen days")}</option>
                  <option value="ONCE">{translate("Once")}</option>
                </select>
                {!chosenDays && repeatErrorText}
              </div>

              <div className="wx-schedule-field">
                <label htmlFor="schedule-effective" className={formLabelCls}>{translate("Effective from")}</label>
                <Input
                  type="date"
                  id="schedule-effective" aria-label={translate("Effective from")} aria-invalid={dateTouched && dateInvalid} aria-describedby={dateTouched && dateInvalid ? "edit-schedule-date-error" : undefined}
                  value={editForm.effectiveDate}
                  onChange={(e) => {
                    setDateTouched(true);
                    setEditForm({ ...editForm, effectiveDate: e.target.value });
                  }}
                  onBlur={() => setDateTouched(true)}
                  min={editForm.effectiveDate === toDateValue(editingTemplate.effectiveDate) ? undefined : todayDate}
                  dir="ltr"
                />
                {dateTouched && dateInvalid && <p className="wx-schedule-error" role="alert" id="edit-schedule-date-error">{formText('Choose {date} or a later date for {location}.', { date: todayDate, location: locationName })}</p>}
              </div>
              {editForm.recurringType === "DAILY" && <p className="wx-schedule-help wx-schedule-full">{translate('Daily schedules include every day, including weekends.')}</p>}
              {chosenDays && (
                <div className="wx-schedule-full">
                  <p className={formLabelCls} aria-hidden="true">{translate('Repeat on')}</p>
                  <WeekdayPicker
                    label="Repeat on"
                    value={editForm.repeatDays}
                    onChange={repeatDays => {
                      setEditForm({ ...editForm, repeatDays });
                      setAssignmentRetry(false);
                      setRepeatError(null);
                    }}
                    summaryKind="schedule"
                    errorId={repeatErrorId}
                  />
                  {repeatErrorText}
                </div>
              )}
              </div>

              </fieldset></form>
              {editingTemplate.areaId && (
                <fieldset disabled={saving}><TemplateInventoryEditor
                  key={editingTemplate.id}
                  templateId={editingTemplate.id}
                  areaId={editingTemplate.areaId}
                /></fieldset>
              )}

              {editError && (
                <div role="alert" className="wx-schedule-error">
                  {editError}
                </div>
              )}

        </div>:null}
      </SidePanel>
    </section>
  );
}
