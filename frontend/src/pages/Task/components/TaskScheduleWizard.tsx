import { useContext, useRef, useState, type ReactNode } from "react";
import { ReactReduxContext } from "react-redux";
import { formatInTimeZone } from "date-fns-tz";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SidePanel, SidePanelFooter } from "@/components/workspace/SidePanel";
import { WeekdayPicker } from "@/components/workspace/WeekdayPicker";
import OperationsState from "@/pages/Manager/OperationsState";
import "../schedule-v6.css";
import { setupErrorKey, useSetupFormText } from '@/pages/Area/areaFormText';
import { useAreas } from "@/pages/Area/queries";
import InventorySelector from "@/pages/Area/InventorySelector";
import { inventorySummary, validateInventorySelection } from "@/pages/Area/types";
import { Link } from "react-router-dom";
import { createTaskTemplate, getTaskTemplate } from "@/pages/Task/api";
import { assignStaffToTaskTemplate } from "@/pages/Assignment/api";
import { useSubscription } from "@/pages/Subscription/queries";
import { invalidateWorkspace } from "@/lib/invalidateWorkspace";
import { useLanguage } from "@/i18n/context";
import { formatDays, isEveryDay, normalizeDays, WEEKDAYS, type Weekday } from "@/lib/workDays";
import { blankCreateForm, buildDateTimeIso, buildEffectiveDate, emptyRepeatDaysMessage, validateScheduleStep, type RecurrenceChoice, type ScheduleStep, type TemplateCreateForm } from "@/pages/Task/taskScheduleForm";
import type { LocationStaff } from "@/pages/Location/types";

export type CreatedSchedule = {
  templateId: number;
  assignment: "automatic" | "manual" | "manual-failed-kept";
};

type Props = {
  locationId: number;
  locationName: string;
  timeZone: string;
  staffOptions: Array<LocationStaff & { workDays?: Weekday[] }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (outcome: CreatedSchedule) => void;
};

type Phase = "editing" | "creating" | "assigning" | "assignment-failed" | "unknown";

const fieldClass = "wx-schedule-input";
const labelClass = "wx-schedule-label";
const labels = ["Task", "Team", "Schedule", "Review"] as const;
const outsideWorkDays = "{name} works {days}. Choose days within those, or use automatic assignment.";
const workerRequiredMessage = "Your plan does not assign staff automatically. Choose a worker for this schedule.";
type RepeatDaysError = "INVALID_REPEAT_DAYS" | "SCHEDULE_OUTSIDE_WORK_DAYS";
type WorkerError = { field: "staffId" | "shiftStart"; message: string };

function errorResponse(error: unknown) {
  return (error as { response?: { status?: number; data?: {
    message?: string;
    errors?: { field?: string; code?: string; message?: string }[];
  } } } | null)?.response;
}

// eslint-disable-next-line react-refresh/only-export-components -- Shared with the schedule edit form.
export function translateScheduleWorkerError(
  error: unknown,
  t: ReturnType<typeof useSetupFormText>,
  workerName?: string,
): WorkerError | undefined {
  const data = errorResponse(error)?.data;
  const detail = data?.errors?.[0];
  const messages = [detail?.message, data?.message].filter((message): message is string => typeof message === "string");
  const fallback = "Could not save the schedule. Check the fields and try again.";

  switch (detail?.code) {
    case "WORKER_REQUIRED":
      return { field: "staffId", message: t(workerRequiredMessage) };
    case "WORKER_OVERLAP": {
      const match = messages.map(message =>
        /^(.+) already has an overlapping schedule: ([\s\S]+)\. Choose a different time or worker\.$/.exec(message)
      ).find(Boolean);
      return { field: "staffId", message: match
        ? t("{name} already has an overlapping schedule: {title}. Choose a different time or worker.", {
          name: workerName ?? match[1], title: match[2],
        })
        : t(fallback) };
    }
    case "SHIFT_MISMATCH": {
      const match = messages.map(message =>
        /^This time falls outside (.+)'s shift \((\d{2}:\d{2})–(\d{2}:\d{2})\)\. Choose a time inside the shift or update the shift\.$/.exec(message)
      ).find(Boolean);
      return { field: "shiftStart", message: match
        ? t("This time falls outside {name}'s shift ({start}–{end}). Choose a time inside the shift or update the shift.", {
          name: workerName ?? match[1], start: match[2], end: match[3],
        })
        : t(fallback) };
    }
  }
}

type PlanFeaturesProps = { children: (requiresWorker: boolean) => ReactNode };

function ScheduleSubscription({ children }: PlanFeaturesProps) {
  const subscription = useSubscription();
  return children(subscription.isSuccess && subscription.data.plan.features.automaticAssignment === false);
}

export function SchedulePlanFeatures({ children }: PlanFeaturesProps) {
  const authContext = useContext(ReactReduxContext);
  return authContext ? <ScheduleSubscription>{children}</ScheduleSubscription> : children(false);
}

export default function TaskScheduleWizard(props: Props) {
  return <SchedulePlanFeatures>{requiresWorker => <ScheduleWizardForm {...props} requiresWorker={requiresWorker} />}</SchedulePlanFeatures>;
}

function ScheduleWizardForm({ locationId, locationName, timeZone, staffOptions, open, onOpenChange, onCreated, requiresWorker }: Props & { requiresWorker: boolean }) {
  const qc = useQueryClient();
  const t = useSetupFormText();
  const { language } = useLanguage();
  const areasQuery = useAreas(locationId);
  const areas = areasQuery.data?.filter(area => area.status === "ACTIVE") ?? [];
  const [form, setForm] = useState<TemplateCreateForm>(() => ({ ...blankCreateForm(), effectiveDate: formatInTimeZone(new Date(), timeZone, "yyyy-MM-dd") }));
  const [step, setStep] = useState<ScheduleStep>(0);
  const [phase, setPhase] = useState<Phase>("editing");
  const [error, setError] = useState<string | null>(null);
  const [workerError, setWorkerError] = useState<WorkerError | null>(null);
  const [repeatError, setRepeatError] = useState<RepeatDaysError | null>(null);
  const [matchedWorkDays, setMatchedWorkDays] = useState(false);
  const savedId = useRef<number | null>(null);
  const inFlight = useRef(false);
  const assignmentInFlight = useRef(false);
  const firstField = useRef<HTMLInputElement | null>(null);
  const siteToday = formatInTimeZone(new Date(), timeZone, "yyyy-MM-dd");
  const busy = phase === "creating" || phase === "assigning";
  const chosenArea = areas.find(area => String(area.id) === form.areaId);
  const summary = chosenArea && inventorySummary(chosenArea, form.inventorySelection, form.selectedItems);
  const chosenStaff = staffOptions.find((staff) => String(staff.id) === form.staffId);
  const missingWorker = requiresWorker && !chosenStaff?.isActive;
  const staffError = workerError?.field === "staffId" ? workerError.message : null;
  const shiftError = workerError?.field === "shiftStart" ? workerError.message : null;
  const staffHelp = t(requiresWorker
    ? workerRequiredMessage
    : "Automatic assignment remains available. You can choose a specific person who works at this location.");
  const workerDays = normalizeDays(chosenStaff?.workDays?.length ? chosenStaff.workDays : undefined);
  const chosenDays = form.recurringType === "CHOSEN";
  const repeating = form.recurringType !== "ONCE";
  const repeatErrorMessage = repeatError === "SCHEDULE_OUTSIDE_WORK_DAYS"
    ? chosenStaff
      ? t(outsideWorkDays, { name: chosenStaff.name, days: formatDays(workerDays, t, language) })
      : t("Could not save the schedule. Check the fields and try again.")
    : t(emptyRepeatDaysMessage);
  const repeatErrorText = repeatError && <p id="schedule-repeat-error" role="alert" className="wx-schedule-error">{repeatErrorMessage}</p>;

  const reset = () => {
    setForm({ ...blankCreateForm(), effectiveDate: formatInTimeZone(new Date(), timeZone, "yyyy-MM-dd") });
    setStep(0);
    setPhase("editing");
    setError(null);
    setWorkerError(null);
    setRepeatError(null);
    setMatchedWorkDays(false);
    savedId.current = null;
    inFlight.current = false;
    assignmentInFlight.current = false;
  };

  const changeOpen = (next: boolean) => {
    if (!next && busy) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const focusFirst = () => requestAnimationFrame(() => firstField.current?.focus());
  const showRepeatError = (problem: RepeatDaysError, showPicker = chosenDays) => {
    setError(null);
    setRepeatError(problem);
    setStep(2);
    requestAnimationFrame(() => document.getElementById(showPicker ? "schedule-repeat-days" : "schedule-repeat")?.focus());
  };

  const pickStaff = (staffId: string) => {
    const days = staffOptions.find(staff => String(staff.id) === staffId)?.workDays;
    const match = form.recurringType === "DAILY" && !!days?.length && !isEveryDay(days);
    setForm(match
      ? { ...form, staffId, recurringType: "CHOSEN", repeatDays: normalizeDays(days) }
      : { ...form, staffId });
    setMatchedWorkDays(match);
    setWorkerError(null);
    setRepeatError(null);
  };

  const pickRecurrence = (recurringType: RecurrenceChoice) => {
    setForm({ ...form, recurringType, recurringEndDate: recurringType === "ONCE" ? "" : form.recurringEndDate });
    setMatchedWorkDays(false);
    setRepeatError(null);
  };

  const validate = (which: ScheduleStep) => {
    if (which === 1 && missingWorker) {
      setStep(1);
      return false;
    }
    const problem = (which === 0 && areasQuery.isError ? "Area inventory could not load. Retry before continuing." : null) ?? validateScheduleStep(form, which) ?? (which === 0 ? chosenArea ? validateInventorySelection(chosenArea, form.inventorySelection, form.selectedItems) : "Choose an active area from the latest inventory." : null);
    if (which === 2) {
      if (problem === emptyRepeatDaysMessage) {
        showRepeatError("INVALID_REPEAT_DAYS");
        return false;
      }
      if (repeating && (chosenDays ? form.repeatDays : WEEKDAYS).some(day => !workerDays.includes(day))) {
        showRepeatError("SCHEDULE_OUTSIDE_WORK_DAYS");
        return false;
      }
      setRepeatError(null);
    }
    if (problem) {
      setError(problem);
      setStep(which);
      focusFirst();
      return false;
    }
    if (which === 2 && form.effectiveDate < siteToday) {
      setError(t('Choose {date} or a later date for {location}.', { date: siteToday, location: locationName }));
      setStep(2);
      focusFirst();
      return false;
    }
    setError(null);
    return true;
  };

  const goNext = () => {
    if (!validate(step)) return;
    setStep((step + 1) as ScheduleStep);
  };

  const invalidateSaved = () => { void invalidateWorkspace(qc).catch(() => undefined); };

  const finish = (assignment: CreatedSchedule["assignment"]) => {
    if (!savedId.current) return;
    onCreated({ templateId: savedId.current, assignment });
    reset();
    onOpenChange(false);
  };

  const assign = async (templateId: number, staffId: number) => {
    if (assignmentInFlight.current) return;
    assignmentInFlight.current = true;
    setPhase("assigning");
    setError(null);
    try {
      await assignStaffToTaskTemplate(templateId, staffId);
      invalidateSaved();
      finish("manual");
    } catch {
      // A timeout may have happened after the server saved the assignment.
      try {
        const current = await getTaskTemplate(templateId);
        if (current?.data?.staffId === staffId) {
          invalidateSaved();
          finish("manual");
          return;
        }
      } catch { /* The saved schedule still exists; its assignment is uncertain. */ }
      setPhase("assignment-failed");
      setError(t('Schedule created. Staff assignment could not be confirmed.'));
    } finally {
      assignmentInFlight.current = false;
    }
  };

  const submit = async () => {
    if (inFlight.current || savedId.current) return;
    for (const part of [0, 1, 2] as ScheduleStep[]) if (!validate(part)) return;
    inFlight.current = true;
    setPhase("creating");
    setError(null);
    setWorkerError(null);
    try {
      const created = await createTaskTemplate({
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        locationId,
        staffId: form.staffId ? Number(form.staffId) : undefined,
        shiftStart: new Date(buildDateTimeIso(timeZone, form.effectiveDate, form.shiftStart)),
        shiftEnd: new Date(buildDateTimeIso(timeZone, form.effectiveDate, form.shiftEnd)),
        recurringType: repeating ? "DAILY" : "ONCE",
        ...(chosenDays && !isEveryDay(form.repeatDays) ? { repeatDays: normalizeDays(form.repeatDays) } : {}),
        effectiveDate: buildEffectiveDate(form.effectiveDate),
        recurringEndDate: repeating && form.recurringEndDate ? buildEffectiveDate(form.recurringEndDate) : undefined,
        areaId: Number(form.areaId),
        inventorySelection: form.inventorySelection,
        selectedItems: form.selectedItems,
        expectedInventoryVersion: chosenArea!.inventoryVersion,
      });
      const id = Number(created?.data?.id);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error("The server did not return a schedule ID. Check the schedule list before trying again.");
      savedId.current = id;
      invalidateSaved();
      if (form.staffId) finish("manual");
      else finish("automatic");
    } catch (err) {
      if (!savedId.current) {
        const response = errorResponse(err);
        const status = response?.status;
        const detail = response?.data?.errors?.[0];
        if (status && status < 500) {
          setPhase("editing");
          const refusal = translateScheduleWorkerError(err, t, chosenStaff?.name);
          if (refusal) {
            setWorkerError(refusal);
            setStep(refusal.field === "staffId" ? 1 : 2);
            requestAnimationFrame(() => document.getElementById(refusal.field === "staffId" ? "schedule-staff" : "schedule-start")?.focus());
            return;
          }
          const code = detail?.code;
          if ((status === 400 && code === "INVALID_REPEAT_DAYS") || (status === 422 && code === "SCHEDULE_OUTSIDE_WORK_DAYS")) {
            if (form.recurringType === "DAILY") setForm({ ...form, recurringType: "CHOSEN", repeatDays: [...WEEKDAYS] });
            showRepeatError(code, repeating);
            return;
          }
          setError(setupErrorKey(err, 'Could not save the schedule. Check the fields and try again.'));
          if (status === 409) {
            const refreshed = await areasQuery.refetch();
            setStep(0);
            setError(refreshed.isError ? 'Inventory could not refresh. Your draft is preserved. Retry loading areas.' : 'Inventory refreshed. Review the selected fixtures before retrying. Your draft is preserved.');
          }
          const field = detail?.field ?? "";
          if (/area|inventory|selected|title|description/.test(field)) setStep(0);
          else if (/staff/.test(field)) setStep(1);
          else if (/shift|date|recurr/.test(field)) setStep(2);
        } else {
          setPhase("unknown");
          setError('Creation could not be confirmed. Check this location’s schedule list before trying again.');
        }
      }
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <SidePanel open={open} onOpenChange={changeOpen} wide title={t('Create cleaning schedule')} description={t('Set up the work, team, and time before saving.')} footer={phase !== 'unknown' && phase !== 'assignment-failed' ? (
            <SidePanelFooter className="wx-schedule-footer"><Button type="button" variant="outline" disabled={busy} onClick={() => step === 0 ? changeOpen(false) : setStep((step - 1) as ScheduleStep)}>{step === 0 ? t('Cancel') : <><ArrowLeft size={15} aria-hidden="true" />{t('Back')}</>}</Button>{step < 3 ? <Button type="button" onClick={goNext} disabled={busy || (step === 0 && (areasQuery.isPending || areasQuery.isError)) || (step === 1 && missingWorker)}>{t('Next')}<ArrowRight size={15} aria-hidden="true" /></Button> : <Button type="button" onClick={() => void submit()} disabled={busy} aria-busy={busy}>{t(busy ? (phase === 'creating' ? 'Creating…' : 'Assigning…') : 'Create schedule')}</Button>}</SidePanelFooter>
    ) : undefined}>
      <div className="wx-schedule-form" aria-busy={busy}>
        <p className="wx-schedule-help"><bdi>{locationName}</bdi> · <bdi>{timeZone}</bdi></p>
        <ol className="wx-schedule-steps" aria-label={t('Schedule creation steps')}>
          {labels.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}>{index + 1}. {t(label)}</li>)}
        </ol>
        {phase === 'assignment-failed' ? (
          <div className="wx-schedule-stack" role="alert">
            <p className="font-semibold">{t('Schedule saved as #{id}', { id: savedId.current ?? '' })}</p>
            <p className="wx-schedule-error">{error && t(error)}</p>
            <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy} onClick={() => { if (savedId.current && form.staffId) void assign(savedId.current, Number(form.staffId)); }}>{t('Retry assignment')}</Button><Button type="button" variant="outline" onClick={() => finish('manual-failed-kept')}>{t('Keep schedule and finish')}</Button></div>
          </div>
        ) : phase === 'unknown' ? (
          <div className="wx-schedule-stack" role="alert"><p className="wx-schedule-error">{error && t(error)}</p><Button type="button" variant="outline" onClick={() => changeOpen(false)}>{t('Close and check schedule list')}</Button></div>
        ) : (
          <>
            <fieldset disabled={busy} aria-describedby={error ? 'schedule-error' : undefined}>
            {step === 0 && <div className="wx-schedule-stack">
              <div><label htmlFor="schedule-title" className={labelClass}>{t('Task title')}</label><Input id="schedule-title" ref={firstField} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder={t('Clean the lobby')} aria-describedby={error ? 'schedule-error' : undefined} /></div>
              <div><label htmlFor="schedule-description" className={labelClass}>{t('Instructions (optional)')}</label><Textarea id="schedule-description" value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} placeholder={t('What should the team do?')} /></div>
              <div><label className={labelClass} htmlFor="schedule-area">{t('Area template')}</label><select id="schedule-area" className={fieldClass} value={form.areaId} disabled={areasQuery.isPending || areasQuery.isError} aria-describedby={error ? 'schedule-error' : undefined} onChange={event => setForm({ ...form, areaId: event.target.value, selectedItems: [] })}><option value="">{t('Choose one area')}</option>{areas.map(area => <option key={area.id} value={area.id}>{area.name}</option>)}</select></div>
              {areasQuery.isPending && <OperationsState loading skeleton="panel" />}
              {areasQuery.isError && <div role="alert"><p>{t('Area inventory could not load. Retry before continuing.')}</p><Button type="button" variant="outline" onClick={() => void areasQuery.refetch()}>{t('Retry loading areas')}</Button></div>}
              {!areasQuery.isPending && !areasQuery.isError && !areas.length && <p className="wx-schedule-help">{t('Set up and activate an area first.')} <Link to={`/locations/${locationId}?tab=areas&newArea=1`} className="text-primary underline">{t('Add area')}</Link></p>}
              {chosenArea && <InventorySelector area={chosenArea} mode={form.inventorySelection} selected={form.selectedItems} onChange={(inventorySelection, selectedItems) => setForm({ ...form, inventorySelection, selectedItems })} />}
            </div>}
            {step === 1 && <div className="wx-schedule-stack">
              {staffError !== t(workerRequiredMessage) && <p id="schedule-staff-help" className="wx-schedule-help">{staffHelp}</p>}
              <label htmlFor="schedule-staff" className={labelClass}>{t('Assign staff')}</label>
              <select
                id="schedule-staff"
                className={fieldClass}
                value={form.staffId}
                required={requiresWorker}
                aria-invalid={staffError ? true : undefined}
                aria-describedby={staffError ? "schedule-staff-error" : "schedule-staff-help"}
                onChange={event => pickStaff(event.target.value)}
              >
                <option value="" disabled={requiresWorker}>{requiresWorker ? "—" : t('Use automatic assignment')}</option>
                {staffOptions.filter(staff => staff.isActive).map(staff => <option key={staff.id} value={staff.id}>{staff.name}</option>)}
              </select>
              {staffError && <p id="schedule-staff-error" role="alert" className="wx-schedule-error">{staffError}</p>}
            </div>}
            {step === 2 && <div className="wx-schedule-pair">
              <div className="wx-schedule-field">
                <label htmlFor="schedule-repeat" className={labelClass}>{t('Recurrence')}</label>
                <select
                  id="schedule-repeat"
                  className={fieldClass}
                  value={form.recurringType}
                  onChange={event => pickRecurrence(event.target.value as RecurrenceChoice)}
                  aria-invalid={!chosenDays && !!repeatError}
                  aria-describedby={!chosenDays && repeatError ? "schedule-repeat-error" : undefined}
                >
                  <option value="DAILY">{t('Daily')}</option>
                  <option value="CHOSEN">{t('Chosen days')}</option>
                  <option value="ONCE">{t('Once')}</option>
                </select>
                {!chosenDays && repeatErrorText}
              </div>
              <div className="wx-schedule-field"><label htmlFor="schedule-date" className={labelClass}>{t('Effective from')}</label><Input id="schedule-date" ref={firstField} type="date" dir="ltr" min={siteToday} value={form.effectiveDate} onChange={event => setForm({ ...form, effectiveDate: event.target.value })} aria-invalid={!!error} aria-describedby={error ? 'schedule-error' : undefined} />{error && <p id="schedule-error" role="alert" className="wx-schedule-error">{t(error)}</p>}</div>
              {!chosenDays && <p className="wx-schedule-help wx-schedule-full">{t('Daily schedules include every day, including weekends.')}</p>}
              <div>
                <label htmlFor="schedule-start" className={labelClass}>{t('Start time')} (<bdi>{timeZone}</bdi>)</label>
                <Input id="schedule-start" type="time" dir="ltr" value={form.shiftStart}
                  aria-invalid={shiftError ? true : undefined} aria-describedby={shiftError ? "schedule-shift-error" : undefined}
                  onChange={event => { setForm({ ...form, shiftStart: event.target.value }); setWorkerError(null); }} />
                {shiftError && <p id="schedule-shift-error" role="alert" className="wx-schedule-error">{shiftError}</p>}
              </div>
              <div><label htmlFor="schedule-end" className={labelClass}>{t('End time')} (<bdi>{timeZone}</bdi>)</label><Input id="schedule-end" type="time" dir="ltr" value={form.shiftEnd} onChange={event => { setForm({ ...form, shiftEnd: event.target.value }); setWorkerError(null); }} /></div>
              {repeating && <div className="wx-schedule-full">
                {chosenDays && <>
                  <p className={labelClass} aria-hidden="true">{t('Repeat on')}</p>
                  <WeekdayPicker
                    id="schedule-repeat-days"
                    label="Repeat on"
                    summaryKind="schedule"
                    value={form.repeatDays}
                    onChange={repeatDays => {
                      setForm({ ...form, repeatDays });
                      setMatchedWorkDays(false);
                      setRepeatError(null);
                    }}
                    errorId={repeatError ? "schedule-repeat-error" : undefined}
                  />
                  {repeatErrorText}
                  {matchedWorkDays && chosenStaff && <p className="wx-schedule-help">{t("Matched to {name}'s work days.", { name: chosenStaff.name })}</p>}
                </>}
                <label htmlFor="schedule-repeat-end" className={labelClass}>{t('Repeat until (optional)')}</label>
                <Input id="schedule-repeat-end" type="date" dir="ltr" min={form.effectiveDate} value={form.recurringEndDate} onChange={event => setForm({ ...form, recurringEndDate: event.target.value })} />
              </div>}
              <p className="wx-schedule-help wx-schedule-full"><bdi>{timeZone}</bdi></p>
            </div>}
            {step === 3 && <div className="wx-schedule-stack"><dl className="wx-schedule-facts"><dt>{t('Task')}</dt><dd><bdi>{form.title.trim()}</bdi></dd><dt>{t('Location')}</dt><dd><bdi>{locationName}</bdi></dd><dt>{t('Area template')}</dt><dd><bdi>{chosenArea?.name}</bdi></dd><dt>{t('Fixtures')}</dt><dd>{form.inventorySelection === 'ALL' ? t('All active items') : t('{count} selected items', { count: form.selectedItems.length })}. {summary && t('{mandatory} mandatory fixtures, {optional} optional fixtures, {photos} required photos.', { ...summary, photos: summary.requiredViews })} {t('Mandatory items require every mandatory evidence view to pass.')}</dd><dt>{t('Team')}</dt><dd>{chosenStaff ? <bdi>{chosenStaff.name}</bdi> : t('Use automatic assignment')}</dd><dt>{t('Schedule')}</dt><dd>{chosenDays
                ? <bdi>{t('Repeats on {days} from {start}', { days: formatDays(form.repeatDays, t, language), start: form.effectiveDate })}</bdi>
                : t('{repeat} from {start}', { repeat: t(repeating ? 'Daily' : 'Once'), start: form.effectiveDate })}{form.recurringEndDate ? <> · {t('Until {date}', { date: form.recurringEndDate })}</> : null} · <bdi>{form.shiftStart}–{form.shiftEnd} ({timeZone})</bdi></dd></dl><p className="wx-schedule-help">{t('A task QR is available only after an occurrence exists. Previewing a future slot does not generate a task.')}</p></div>}
            </fieldset>
            {error && step !== 2 && <p id="schedule-error" role="alert" className="wx-schedule-error">{t(error)}</p>}

          </>
        )}
      </div>
    </SidePanel>
  );
}
