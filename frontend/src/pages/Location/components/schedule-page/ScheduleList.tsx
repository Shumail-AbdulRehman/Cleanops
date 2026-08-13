import { useId } from "react";
import { ChevronRight } from "lucide-react";
import { PersonAvatar } from "@/components/workspace/PersonAvatar";
import { StatusPill } from "@/components/workspace/StatusPill";
import { useLanguage } from "@/i18n/context";
import { formatDays, WEEKDAYS, WEEKDAY_LABELS } from "@/lib/workDays";
import type { ScheduleGroup, ScheduleRow } from "../../schedulePageModel";
import "./ScheduleList.css";

export interface ScheduleListProps {
  groups: readonly ScheduleGroup[];
  selectedId: number | null;
  onOpen: (id: number) => void;
  onClearFilters: () => void;
}

function dateLabel(date: string, includeWeekday: boolean, language: string): string {
  const calendarDate = new Date(`${date}T00:00:00Z`);
  const label = Number.isNaN(calendarDate.getTime()) ? date : new Intl.DateTimeFormat(
    language === "ur" ? "ur-PK" : "en-GB",
    { timeZone: "UTC", day: "numeric", month: "short", weekday: includeWeekday ? "short" : undefined },
  ).format(calendarDate);
  // Keep the date isolated inside the translated pill, whose content is a string.
  return `\u2066${label}\u2069`;
}

function ScheduleListRow({ row, selected, onOpen }: {
  row: ScheduleRow;
  selected: boolean;
  onOpen: ScheduleListProps["onOpen"];
}) {
  const { t, language } = useLanguage();
  const { start, end, duration, worker } = row;
  const days = row.recurringType === "ONCE" ? t("Once") : formatDays(row.weekdays, t, language);
  const dateTag = row.onceDate
    ? t("Once · {date}", { date: dateLabel(row.onceDate, true, language) })
    : row.futureStartDate && t("Starts {date}", { date: dateLabel(row.futureStartDate, false, language) });
  const durationLabel = duration && t(
    duration.hours === 0 ? "{minutes} min" : duration.minutes === 0 ? "{hours} h" : "{hours} h {minutes} min",
    duration,
  );

  return (
    <li className="schedule-list__item">
      <button
        type="button"
        className="schedule-list__row"
        data-inactive={row.inactive || undefined}
        aria-current={selected || undefined}
        aria-haspopup="dialog"
        onClick={() => onOpen(row.id)}
      >
        <span className="schedule-list__time">
          <bdi dir="ltr" className="schedule-list__primary">
            {start && end ? `${start}–${end}` : (start ?? end ?? "—")}
          </bdi>
          {durationLabel && <span className="schedule-list__secondary">{durationLabel}</span>}
        </span>
        <span className="schedule-list__days">
          <span aria-hidden="true" className="schedule-list__letters">
            {WEEKDAYS.map(day => (
              <span key={day} data-active={row.weekdays.includes(day) || undefined}>
                {t(WEEKDAY_LABELS[day].short).slice(0, 1)}
              </span>
            ))}
          </span>
          <span className="schedule-list__secondary schedule-list__day-text">{days}</span>
        </span>
        <span className="schedule-list__schedule">
          <bdi className="schedule-list__primary schedule-list__truncate">{row.title}</bdi>
          <span className="schedule-list__secondary schedule-list__truncate">
            <bdi>{row.areaName ?? t("No area")}</bdi>
            {" · "}
            {t(row.fixturesChoice === "ALL" ? "All active items" : "Fixtures")}
          </span>
        </span>
        <span className="schedule-list__worker" data-unassigned={worker === null || undefined}>
          <PersonAvatar name={worker?.name} className="schedule-list__avatar" />
          <bdi className="schedule-list__truncate">
            {worker ? worker.name || t("Staff member") : t("Unassigned")}
          </bdi>
        </span>
        <span className="schedule-list__tags">
          {row.needsReview && <StatusPill tone="attention" className="schedule-list__tag">Needs review</StatusPill>}
          {row.inactive && <StatusPill className="schedule-list__tag">Inactive</StatusPill>}
          {dateTag && <StatusPill className="schedule-list__tag">{dateTag}</StatusPill>}
        </span>
        <ChevronRight className="schedule-list__chevron" aria-hidden="true" size={16} />
      </button>
    </li>
  );
}

export function ScheduleList({ groups, selectedId, onOpen, onClearFilters }: ScheduleListProps) {
  const { language, t } = useLanguage();
  const headingId = useId();
  const direction = language === "ur" ? "rtl" : "ltr";

  if (groups.length === 0) {
    return (
      <div className="schedule-list__empty" dir={direction} lang={language}>
        <h3>{t("No schedules match")}</h3>
        <p>{t("Nothing matches these filters. Try another word or clear the filters.")}</p>
        <button type="button" className="schedule-list__clear" onClick={onClearFilters}>
          {t("Clear filters")}
        </button>
      </div>
    );
  }

  return (
    <div className="schedule-list" dir={direction} lang={language}>
      <div className="schedule-list__header" aria-hidden="true">
        <span className="schedule-list__time">{t("Time")}</span>
        <span className="schedule-list__days">{t("Days")}</span>
        <span className="schedule-list__schedule">{t("Schedule")}</span>
        <span className="schedule-list__worker">{t("Assigned to")}</span>
      </div>
      {groups.map((group, index) => {
        const id = `${headingId}-${index}`;
        return (
          <section className="schedule-list__group" aria-labelledby={id} key={group.key}>
            <div className="schedule-list__group-heading">
              <h3 id={id}><bdi>{group.labelKey ? t(group.labelKey) : group.label ?? "—"}</bdi></h3>
              <span className="schedule-list__secondary">
                {group.rangeText && <><bdi dir="ltr">{group.rangeText}</bdi>{" · "}</>}
                <bdi dir="ltr">{group.rows.length}</bdi>
              </span>
            </div>
            <ul className="schedule-list__items" role="list">
              {group.rows.map(row => (
                <ScheduleListRow key={row.id} row={row} selected={row.id === selectedId} onOpen={onOpen} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
