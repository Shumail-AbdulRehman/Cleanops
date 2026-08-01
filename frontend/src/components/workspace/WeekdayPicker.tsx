import { useLanguage } from "@/i18n/context";
import { formatDays, normalizeDays, WEEKDAY_LABELS, WEEKDAYS, type Weekday } from "@/lib/workDays";
import "./filter-controls.css";

export interface WeekdayPickerProps {
  label: "Work days" | "Repeat on";
  value?: readonly Weekday[] | null;
  onChange: (days: Weekday[]) => void;
  summaryKind?: "staff" | "schedule";
  errorId?: string;
  disabled?: boolean;
  id?: string;
}

export function WeekdayPicker({ label, value, onChange, summaryKind, errorId, disabled, id }: WeekdayPickerProps) {
  const { t, language } = useLanguage();
  const dir = language === "ur" ? "rtl" : "ltr";
  const selected = normalizeDays(value);
  const everyDay = selected.length === WEEKDAYS.length;
  let summary: string | undefined;
  if (summaryKind && selected.length) {
    if (everyDay) {
      summary = t(summaryKind === "staff" ? "Works every day" : "Repeats every day");
    } else {
      summary = t(summaryKind === "staff" ? "Works {count} days: {days}" : "Repeats on {days}", {
        count: selected.length,
        days: formatDays(selected, t, language),
      });
    }
  }

  return (
    <>
      <div
        className="wx-chip-group"
        role="group"
        aria-label={t(label)}
        dir={dir}
        aria-invalid={errorId ? true : undefined}
        aria-describedby={errorId}
        id={id}
        tabIndex={id ? -1 : undefined}
      >
        {WEEKDAYS.map(day => {
          const pressed = selected.includes(day);
          return (
            <button
              key={day}
              type="button"
              className="wx-filter-chip"
              style={{ minBlockSize: "var(--wx-touch-target-min)", minInlineSize: "var(--wx-touch-target-min)" }}
              aria-label={t(WEEKDAY_LABELS[day].full)}
              aria-pressed={pressed}
              disabled={disabled}
              onClick={() => onChange(pressed ? selected.filter(item => item !== day) : normalizeDays([...selected, day]))}
            >
              <bdi className="wx-filter-label">{t(WEEKDAY_LABELS[day].short)}</bdi>
            </button>
          );
        })}
      </div>
      {summary && <p className={summaryKind === "staff" ? "wx-side-panel-description" : "wx-schedule-help"} dir={dir}>{summary}</p>}
    </>
  );
}
