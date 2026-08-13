import { useId } from "react";
import { PersonAvatar } from "@/components/workspace/PersonAvatar";
import { useLanguage } from "@/i18n/context";
import { formatDays } from "@/lib/workDays";
import type { ScheduleRow, ScheduleStaffWeekCell, ScheduleStaffWeekRow } from "../../schedulePageModel";
import "./ScheduleStaffWeek.css";

export interface ScheduleStaffWeekProps {
  rows: readonly ScheduleStaffWeekRow[];
  days: readonly { date: string; label: string; isToday: boolean }[];
  agenda: readonly ScheduleRow[];
  agendaLabel: string;
  onOpen: (id: number) => void;
}

const visibleJobsPerCell = 3;

function WeekCell({ cell, isToday, onOpen }: {
  cell: ScheduleStaffWeekCell;
  isToday: boolean;
  onOpen: ScheduleStaffWeekProps["onOpen"];
}) {
  const { t } = useLanguage();
  const { dayOff, jobs } = cell;
  const firstExtraJob = jobs[visibleJobsPerCell];

  return (
    <td className="schedule-staff-week__cell" data-today={isToday || undefined} data-day-off={dayOff || undefined}>
      {dayOff ? t("Day off") : (
        <div className="schedule-staff-week__blocks">
          {jobs.slice(0, visibleJobsPerCell).map(job => (
            <button
              key={job.id}
              type="button"
              className="schedule-staff-week__block"
              aria-haspopup="dialog"
              onClick={() => onOpen(job.id)}
            >
              <bdi dir="ltr" className="schedule-staff-week__start">{job.start ?? "—"}</bdi>{" "}
              <bdi className="schedule-staff-week__block-title">{job.title}</bdi>
            </button>
          ))}
          {firstExtraJob && (
            <button
              type="button"
              className="schedule-staff-week__more"
              aria-haspopup="dialog"
              onClick={() => onOpen(firstExtraJob.id)}
            >
              {t("+{count} more", { count: jobs.length - visibleJobsPerCell })}
            </button>
          )}
        </div>
      )}
    </td>
  );
}

function AgendaItem({ job, onOpen }: { job: ScheduleRow; onOpen: ScheduleStaffWeekProps["onOpen"] }) {
  const { t } = useLanguage();
  const { worker } = job;
  const firstName = worker?.name?.trim().split(/\s+/, 1)[0];

  return (
    <li>
      <button
        type="button"
        className="schedule-staff-week__agenda-row"
        data-unassigned={worker === null || undefined}
        aria-haspopup="dialog"
        onClick={() => onOpen(job.id)}
      >
        <span className="schedule-staff-week__agenda-time">
          <bdi dir="ltr" className="schedule-staff-week__primary">{job.start ?? "—"}</bdi>{" "}
          <bdi dir="ltr" className="schedule-staff-week__secondary">{job.end ?? "—"}</bdi>
        </span>{" "}
        <span className="schedule-staff-week__agenda-schedule">
          <bdi className="schedule-staff-week__primary">{job.title}</bdi>{" "}
          <bdi className="schedule-staff-week__secondary">{job.areaName ?? t("No area")}</bdi>
        </span>{" "}
        <span className="schedule-staff-week__agenda-worker">
          <PersonAvatar name={worker?.name} className="schedule-staff-week__avatar" />
          <bdi>{worker ? firstName || t("Staff member") : t("Unassigned")}</bdi>
        </span>
      </button>
    </li>
  );
}

export function ScheduleStaffWeek({ rows, days, agenda, agendaLabel, onOpen }: ScheduleStaffWeekProps) {
  const { t, language } = useLanguage();
  const headingId = useId();
  const today = days.find(day => day.isToday)?.date;

  return (
    <div className="schedule-staff-week" lang={language} dir={language === "ur" ? "rtl" : "ltr"}>
      <div className="schedule-staff-week__grid">
        <table className="schedule-staff-week__table" aria-label={t("Week")}>
          <thead>
            <tr>
              <th scope="col" className="schedule-staff-week__staff-heading">{t("Staff")}</th>
              {days.map(day => (
                <th scope="col" key={day.date} data-today={day.isToday || undefined}>
                  <time dateTime={day.date} aria-current={day.isToday ? "date" : undefined}>
                    <bdi dir="ltr">{day.label}</bdi>
                  </time>
                  {day.isToday && <> · {t("Today")}</>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ worker, count, days: cells }) => (
              <tr key={worker?.id ?? "unassigned"} data-unassigned={worker === null || undefined}>
                <th scope="row" className="schedule-staff-week__person">
                  <div className="schedule-staff-week__identity">
                    <PersonAvatar name={worker?.name} className="schedule-staff-week__avatar" />
                    <div className="schedule-staff-week__person-info">
                      <bdi className="schedule-staff-week__primary schedule-staff-week__name">
                        {worker ? worker.name || t("Staff member") : t("Unassigned")}
                      </bdi>{" "}
                      <span className="schedule-staff-week__secondary">
                        {worker ? (
                          <>
                            {formatDays(worker.workDays, t, language)}
                            {worker.shiftText && <> · <bdi dir="ltr">{worker.shiftText}</bdi></>}
                          </>
                        ) : t("Needs a worker")}
                      </span>{" "}
                      <span className="schedule-staff-week__secondary">{t("{count} jobs this week", { count })}</span>
                    </div>
                  </div>
                </th>
                {cells.map(cell => <WeekCell key={cell.date} cell={cell} isToday={cell.date === today} onOpen={onOpen} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="schedule-staff-week__agenda" aria-labelledby={headingId}>
        <header className="schedule-staff-week__agenda-heading">
          <h3 id={headingId}><bdi dir="ltr">{agendaLabel}</bdi></h3>
          <span className="schedule-staff-week__secondary">{t("{count} jobs", { count: agenda.length })}</span>
        </header>
        {agenda.length > 0 && (
          <ul className="schedule-staff-week__agenda-list" role="list">
            {agenda.map(job => <AgendaItem key={job.id} job={job} onOpen={onOpen} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
