import { Pencil } from "lucide-react";
import { Link } from "react-router-dom";
import DeleteButton from "@/components/common/DeleteButton";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/workspace/PersonAvatar";
import { SidePanel, SidePanelFooter } from "@/components/workspace/SidePanel";
import { formatDays, WEEKDAYS, WEEKDAY_LABELS } from "@/lib/workDays";
import { useSetupFormText } from "@/pages/Area/areaFormText";
import { useLocationLanguage } from "../../locationTranslations";
import type { ScheduleDetails, ScheduleTimes } from "../../schedulePageModel";
import "./ScheduleDetailsPanel.css";

export interface ScheduleDetailsPanelProps {
  details: ScheduleDetails | null;
  areaHref: string;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => Promise<unknown>;
  deleteDisabled?: boolean;
}

const deleteDescription = "This removes the schedule and today's and future tasks from active work. Past task history and recorded evidence are kept.";
const reviewDescription = {
  en: "Review the area's updated fixtures before the next task.",
  ur: "اگلے کام سے پہلے حصے کے تبدیل شدہ فکسچر کا جائزہ لیں۔",
};

function timeRange({ start, end }: Pick<ScheduleTimes, "start" | "end">) {
  return start && end ? `${start}–${end}` : start ?? end ?? "—";
}

// SidePanel takes strings, so use the Unicode equivalent of a <bdi> for its headings.
function isolateName(name: string) {
  return `\u2068${name}\u2069`;
}

export function ScheduleDetailsPanel({
  details, areaHref, onClose, onEdit, onDelete, deleteDisabled = false,
}: ScheduleDetailsPanelProps) {
  const { language, t } = useLocationLanguage();
  const setupText = useSetupFormText();
  if (!details) return null;

  const { facts, nextDays } = details;
  const { worker, duration, effectiveDate, futureStartDate } = facts;
  const locale = language === "ur" ? "ur-PK" : "en-GB";
  const dateFormat = new Intl.DateTimeFormat(locale, {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
  const nextDateFormat = new Intl.DateTimeFormat(locale, {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
  });
  const durationLabel = duration && (duration.hours === 0
    ? t("{minutes} min", duration)
    : duration.minutes === 0 ? t("{hours} h", duration) : t("{hours} h {minutes} min", duration));
  const workerDays = worker?.workDays && formatDays(worker.workDays, t, language);
  const workerShift = worker?.shiftText;

  return (
    <SidePanel
      open
      title={isolateName(facts.title)}
      description={facts.areaName ? isolateName(facts.areaName) : t("No area")}
      onOpenChange={open => { if (!open) onClose(); }}
      footer={
        <SidePanelFooter className="wx-schedule-details-footer">
          <Button type="button" className="wx-schedule-details-edit" onClick={onEdit}>
            <Pencil aria-hidden="true" />
            {t("Edit schedule")}
          </Button>
          <fieldset className="wx-schedule-details-delete" disabled={deleteDisabled}>
            <DeleteButton
              key={facts.id}
              name={facts.title}
              description={deleteDescription}
              preserveHistory
              onDelete={onDelete}
            />
          </fieldset>
        </SidePanelFooter>
      }
    >
      <div className="wx-schedule-details">
        <dl className="wx-schedule-details-facts">
          <dt>{t("Time")}</dt>
          <dd>
            <strong><bdi dir="ltr">{timeRange(facts)}</bdi></strong>
            {durationLabel && <> · {durationLabel}</>}
          </dd>
          <dt>{t("Repeats")}</dt>
          <dd className="wx-schedule-details-repeat">
            <span className="wx-schedule-details-letters" aria-hidden="true">
              {WEEKDAYS.map(day => (
                <span key={day} data-active={facts.weekdays.includes(day)}>
                  {t(WEEKDAY_LABELS[day].short).slice(0, 1)}
                </span>
              ))}
            </span>
            <span>{facts.recurringType === "ONCE" ? t("Once") : formatDays(facts.weekdays, t, language)}</span>
          </dd>
          <dt>{setupText("Fixtures")}</dt>
          <dd>{t(facts.fixturesChoice === "SUBSET" ? "Selected fixtures" : "All active fixtures")}</dd>
          <dt className={futureStartDate ? "sr-only" : undefined}>{t(futureStartDate ? "Effective date" : "Started")}</dt>
          <dd className={futureStartDate ? "wx-schedule-details-future" : undefined}>
            {futureStartDate
              ? t("Starts {date}", { date: `\u2066${dateFormat.format(new Date(`${futureStartDate}T00:00:00Z`))}\u2069` })
              : effectiveDate
                ? <time dateTime={effectiveDate}><bdi dir="ltr">{dateFormat.format(new Date(`${effectiveDate}T00:00:00Z`))}</bdi></time>
                : "—"}
          </dd>
          <dt>{t("Assigned to")}</dt>
          <dd className="wx-schedule-details-worker">
            <PersonAvatar name={worker?.name} className={worker ? undefined : "wx-schedule-details-open-avatar"} />
            {worker ? (
              <div>
                <strong><bdi>{worker.name || "—"}</bdi></strong>
                {(workerDays || workerShift) && (
                  <div className="wx-schedule-details-shift">
                    {t("Works {days} · {shift}", { days: workerDays || "—", shift: workerShift ? `\u2066${workerShift}\u2069` : "—" })}
                  </div>
                )}
              </div>
            ) : <strong className="wx-schedule-details-unassigned">{t("Unassigned")}</strong>}
          </dd>
        </dl>

        {facts.needsReview && (
          <div className="wx-schedule-details-review">
            <h3>{t("Inventory needs review")}</h3>
            <p>{t(reviewDescription[language])}</p>
            <Link to={areaHref}>{t("Review area")}</Link>
          </div>
        )}

        {nextDays.length > 0 && (
          <div className="wx-schedule-details-upcoming">
            <h3>{t("Next scheduled days")}</h3>
            <ul role="list">
              {nextDays.map(day => (
                <li key={day.date}>
                  <time dateTime={day.date}>
                    <bdi dir="ltr">{nextDateFormat.format(new Date(`${day.date}T00:00:00Z`))}</bdi>
                  </time>
                  <bdi dir="ltr">{timeRange(day)}</bdi>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </SidePanel>
  );
}
