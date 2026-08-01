import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover } from "radix-ui";
import { useLanguage } from "@/i18n/context";
import { cn } from "@/lib/utils";
import "./filter-controls.css";

export interface DateQuickOption { label: string; value: string }
export interface DateMenuProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  maxDate?: string;
  /** Today's date in the caller's location; defaults to the device's local day. */
  localDate?: string;
  /** Defaults to Today and Yesterday. An empty value can represent All dates. */
  quickOptions?: readonly DateQuickOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

// UTC is only an arithmetic/formatting container. Values never pass through UTC
// conversion from a local instant, so a selected calendar day cannot shift zones.
function parseDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(12, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}
function dayString(date: Date) {
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
function addDays(date: Date, count: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + count);
  return next;
}
function monthStart(date: Date) {
  const next = new Date(date);
  next.setUTCDate(1);
  return next;
}
function addMonths(date: Date, count: number) {
  const next = monthStart(date);
  next.setUTCMonth(next.getUTCMonth() + count);
  const end = new Date(next);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  next.setUTCDate(Math.min(date.getUTCDate(), end.getUTCDate()));
  return next;
}

export function DateMenu({ value, onChange, label = "Date", maxDate, localDate, quickOptions, placeholder = "All dates", disabled, className }: DateMenuProps) {
  const { t, language } = useLanguage();
  const dir = language === "ur" ? "rtl" : "ltr";
  const locale = language === "ur" ? "ur-PK" : "en-PK";
  const now = new Date();
  const deviceDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const today = parseDay(localDate ?? "") ?? parseDay(deviceDay)!;
  const maximum = parseDay(maxDate ?? "");
  const max = maximum ? dayString(maximum) : null;
  const selected = value === "today" ? today : parseDay(value);
  const initialDay = selected && (!max || dayString(selected) <= max) ? selected : maximum ?? today;
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthStart(initialDay));
  const [focusedDay, setFocusedDay] = useState(() => dayString(initialDay));
  const grid = useRef<HTMLTableElement>(null);
  const requestFocus = useRef(false);
  const headingId = useId();
  useLayoutEffect(() => {
    if (requestFocus.current) {
      grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focusedDay}"]`)?.focus();
      requestFocus.current = false;
    }
  }, [focusedDay, month]);

  const quick = quickOptions ?? [{ label: "Today", value: "today" }, { label: "Yesterday", value: dayString(addDays(today, -1)) }];
  const fullDate = (day: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" }).format(day);
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(month);
  const triggerLabel = value === "today" ? t("Today") : selected
    ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(selected)
    : t(quick.find(option => option.value === value)?.label ?? placeholder);
  const allowed = (date: Date) => date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999 && (!max || dayString(date) <= max);
  const quickDisabled = (item: DateQuickOption) => {
    if (item.value === "") return false;
    const date = item.value === "today" ? today : parseDay(item.value);
    return !date || !allowed(date);
  };
  const choose = (next: string) => { onChange(next); setOpen(false); };
  const moveFocus = (next: Date) => {
    if (!allowed(next)) return;
    requestFocus.current = true;
    setMonth(monthStart(next));
    setFocusedDay(dayString(next));
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, date: Date) => {
    const weekday = (date.getUTCDay() + 6) % 7;
    let next: Date;
    switch (event.key) {
      case "ArrowLeft": next = addDays(date, dir === "rtl" ? 1 : -1); break;
      case "ArrowRight": next = addDays(date, dir === "rtl" ? -1 : 1); break;
      case "ArrowUp": next = addDays(date, -7); break;
      case "ArrowDown": next = addDays(date, 7); break;
      case "Home": next = addDays(date, -weekday); break;
      case "End": next = addDays(date, 6 - weekday); break;
      case "PageUp": next = addMonths(date, event.shiftKey ? -12 : -1); break;
      case "PageDown": next = addMonths(date, event.shiftKey ? 12 : 1); break;
      default: return;
    }
    event.preventDefault();
    moveFocus(next);
  };
  const changeMonth = (offset: number) => {
    const next = addMonths(month, offset);
    if (!allowed(next)) return;
    setMonth(next);
    setFocusedDay(dayString(next));
  };
  const start = (month.getUTCDay() + 6) % 7;
  const nextMonth = addMonths(month, 1);
  const days = new Date(nextMonth.getTime() - 86400000).getUTCDate();
  const weeks = Math.ceil((start + days) / 7);

  return (
    <Popover.Root open={open} onOpenChange={next => {
      if (next) { setMonth(monthStart(initialDay)); setFocusedDay(dayString(initialDay)); }
      setOpen(next);
    }}>
      <Popover.Trigger asChild>
        <button type="button" className={cn("wx-filter-trigger", className)} disabled={disabled} aria-label={`${t(label)}: ${triggerLabel}`}>
          <CalendarDays className="wx-filter-icon" aria-hidden="true" /><span className="wx-filter-label">{triggerLabel}</span>
          <ChevronDown className="wx-filter-chevron" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <div className="workspace wx-filter-portal" dir={dir} lang={language === "ur" ? "ur-PK" : "en-PK"}>
          <Popover.Content className="wx-date-menu" align="start" sideOffset={6} collisionPadding={12} aria-label={t(label)} dir={dir}>
            {quick.length > 0 && <div className="wx-date-quick" role="group" aria-label={t(label)}>
              {quick.map(item => <button type="button" className="wx-filter-chip" key={item.value} aria-pressed={item.value === value}
                disabled={quickDisabled(item)} onClick={() => choose(item.value)}>{t(item.label)}</button>)}
            </div>}
            <div className="wx-date-heading">
              <button type="button" className="wx-filter-icon-button" aria-label={t("Previous month")} disabled={!allowed(addMonths(month, -1))} onClick={() => changeMonth(-1)}>
                <ChevronLeft className="wx-directional" aria-hidden="true" />
              </button>
              <span id={headingId} aria-live="polite">{monthLabel}</span>
              <button type="button" className="wx-filter-icon-button" aria-label={t("Next month")} disabled={!allowed(nextMonth)} onClick={() => changeMonth(1)}>
                <ChevronRight className="wx-directional" aria-hidden="true" />
              </button>
            </div>
            <table className="wx-date-grid" role="grid" aria-labelledby={headingId} ref={grid}>
              <thead><tr>{["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day, index) => <th key={day} scope="col"
                aria-label={new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(addDays(parseDay("2024-01-01")!, index))}>{t(day)}</th>)}</tr></thead>
              <tbody>{Array.from({ length: weeks }, (_, week) => <tr key={week}>
                {Array.from({ length: 7 }, (_, column) => {
                  const day = week * 7 + column - start + 1;
                  if (day < 1 || day > days) return <td key={column} />;
                  const date = addDays(month, day - 1);
                  const stamp = dayString(date);
                  return <td key={column} aria-selected={selected ? stamp === dayString(selected) : false}>
                    <button type="button" className="wx-date-day" data-day={stamp} aria-label={fullDate(date)}
                      aria-current={stamp === dayString(today) ? "date" : undefined} disabled={!allowed(date)}
                      tabIndex={stamp === focusedDay ? 0 : -1} onFocus={() => setFocusedDay(stamp)}
                      onKeyDown={event => keyDown(event, date)} onClick={() => choose(stamp)}>{day.toLocaleString(locale)}</button>
                  </td>;
                })}
              </tr>)}</tbody>
            </table>
          </Popover.Content>
        </div>
      </Popover.Portal>
    </Popover.Root>
  );
}

export default DateMenu;
