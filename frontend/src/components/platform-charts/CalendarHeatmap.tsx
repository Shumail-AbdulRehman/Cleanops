import { useLanguage } from '@/i18n/context';
import './shape-charts.css';

interface CalendarHeatmapProps {
  label: string;
  days: readonly { date: string; count: number | null }[];
  unit?: string;
}

const dayMilliseconds = 86_400_000;
const dayLabels = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];

function chartDay(date: string) {
  return Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / dayMilliseconds;
}

export function CalendarHeatmap({ label, days, unit }: CalendarHeatmapProps) {
  const { t } = useLanguage();
  if (days.length === 0) {
    return <p>{t('No activity yet')}</p>;
  }

  const dated = days.map((day) => ({ ...day, day: chartDay(day.date) }));
  const firstDay = Math.min(...dated.map(({ day }) => day));
  const lastDay = Math.max(...dated.map(({ day }) => day));
  // The Unix epoch started on Thursday, three days into a Monday-first week.
  const weekday = ((firstDay + 3) % 7 + 7) % 7;
  const startMonday = firstDay - weekday;
  const weeks = 1 + Math.floor((lastDay - startMonday) / 7);
  const max = Math.max(1, ...days.map(({ count }) => count ?? 0));
  const total = days.some(({ count }) => count === null)
    ? t('Not available')
    : [days.reduce((sum, { count }) => sum + (count ?? 0), 0), unit && t(unit)].filter((value) => value !== undefined).join(' ');
  const levels = [0, 1, 2, 3, 4];

  return (
    <div className="px-calendar-heatmap">
      <div className="px-heat-grid" role="img" aria-label={`${t(label)}: ${total}`}
        style={{ gridTemplateColumns: `auto repeat(${weeks}, minmax(0, 42px))` }}>
        {dayLabels.map((day, index) => (
          <span key={index} className="px-heat-day" style={{ gridRow: index + 1 }}>
            {day && t(day)}
          </span>
        ))}
        {dated.map(({ date, day, count }) => {
          const offset = day - startMonday;
          const level = count === null ? undefined : Math.ceil(count / max * 4);
          const value = count === null ? t('Not available') : unit ? `${count} ${t(unit)}` : String(count);
          return (
            <span key={date} className="px-heat-cell" data-level={level}
              title={`${date.slice(0, 10)}: ${value}`}
              style={{ gridRow: offset % 7 + 1, gridColumn: Math.floor(offset / 7) + 2 }} />
          );
        })}
      </div>
      <div className="px-heat-key">
        <span>{t('Less')}</span>
        {levels.map((level) => <span key={level} className="px-heat-cell" data-level={level} aria-hidden="true" />)}
        <span>{t('More')}</span>
      </div>
    </div>
  );
}
