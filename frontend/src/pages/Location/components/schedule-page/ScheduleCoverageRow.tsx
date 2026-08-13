import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { WEEKDAY_LABELS, type Weekday } from "@/lib/workDays";
import { useLocationLanguage } from "../../locationTranslations";
import type { ScheduleCoverageDay } from "../../schedulePageModel";
import "./ScheduleCoverageRow.css";

interface ScheduleCoverageRowProps {
  coverage: readonly ScheduleCoverageDay[];
  weekLabel: string;
  selectedWeekday: Weekday | null;
  onChooseDay: (weekday: Weekday) => void;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onThisWeek: () => void;
}

export function ScheduleCoverageRow({
  coverage,
  weekLabel,
  selectedWeekday,
  onChooseDay,
  onPreviousWeek,
  onNextWeek,
  onThisWeek,
}: ScheduleCoverageRowProps) {
  const { language, t } = useLocationLanguage();
  const fullDate = new Intl.DateTimeFormat(language === "ur" ? "ur-PK" : "en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  });
  const [jobsPrefix, jobsSuffix] = t("{count} jobs").split("{count}");
  const todayLabel = t("Today");

  return (
    <div className="schedule-coverage">
      <div className="schedule-coverage__bar">
        <div className="schedule-coverage__navigation">
          <Button
            type="button"
            className="schedule-coverage__week-arrow"
            variant="outline"
            size="icon"
            aria-label={t("Previous week")}
            onClick={onPreviousWeek}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <bdi dir="ltr">{weekLabel}</bdi>
          <Button
            type="button"
            className="schedule-coverage__week-arrow"
            variant="outline"
            size="icon"
            aria-label={t("Next week")}
            onClick={onNextWeek}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="schedule-coverage__this-week"
            onClick={onThisWeek}
          >
            {t("This week")}
          </Button>
        </div>
        <p className="schedule-coverage__hint">
          {t("Jobs and staff on each day. Choose a day to filter.")}
        </p>
      </div>
      <div className="schedule-coverage__days">
        {coverage.map(day => {
          const weekday = WEEKDAY_LABELS[day.weekday];
          const staffLabel = t("{count} staff", { count: day.staffOn });
          const openLabel = day.open > 0 ? t("{count} open", { count: day.open }) : null;
          const spokenDate = fullDate.format(new Date(`${day.date}T00:00:00Z`));
          const label = [
            `${t(weekday.full)} ${spokenDate}`,
            day.isToday && todayLabel,
            t("{count} jobs", { count: day.jobs }),
            staffLabel,
            openLabel,
          ].filter(Boolean).join(language === "ur" ? "، " : ", ");

          return (
            <button
              key={day.date}
              type="button"
              className="schedule-coverage__day"
              data-today={day.isToday}
              aria-label={label}
              aria-pressed={selectedWeekday === day.weekday}
              onClick={() => onChooseDay(day.weekday)}
            >
              <span className="schedule-coverage__day-heading">
                <time dateTime={day.date}>
                  {t(weekday.short)} <bdi dir="ltr">{Number(day.date.slice(-2))}</bdi>
                </time>
                {day.isToday && <span className="schedule-coverage__today">{todayLabel}</span>}
              </span>
              <span className="schedule-coverage__jobs">
                {jobsPrefix}<strong>{day.jobs}</strong>{jobsSuffix}
              </span>
              <span className="schedule-coverage__meter" aria-hidden="true">
                <span style={{ inlineSize: `${day.load * 100}%` }} />
              </span>
              <span className="schedule-coverage__counts">
                <span className="schedule-coverage__staff">{staffLabel}</span>
                {openLabel && <span className="schedule-coverage__open">{openLabel}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
