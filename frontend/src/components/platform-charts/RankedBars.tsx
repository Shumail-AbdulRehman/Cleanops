import { useLanguage } from '@/i18n/context';
import type { PlanChartTone } from './DonutChart';
import './shape-charts.css';

type RankedBarTone = PlanChartTone | 'blue' | 'mid' | 'warn' | 'bad' | 'good';

interface RankedBarsProps {
  label: string;
  rows: readonly { name: string; value: number | null; href?: string; tone?: RankedBarTone }[];
  formatValue?: (value: number) => string;
}

export function RankedBars({ label, rows, formatValue = String }: RankedBarsProps) {
  const { t } = useLanguage();
  const max = Math.max(0, ...rows.map(({ value }) => value ?? 0));
  return (
    <ol className="px-shape-list" role="list" aria-label={t(label)}>
      {rows.map(({ name, value, href, tone = 'blue' }) => {
        const rowName = t(name);
        const rowValue = value === null ? t('Not available') : formatValue(value);
        const content = (
          <>
            <span className="px-shape-row">
              <span>{rowName}</span>
              <strong>{rowValue}</strong>
            </span>
            {value !== null && (
              <span className="px-ranked-track" aria-hidden="true">
                <span data-tone={tone} style={{ width: `${max > 0 ? value / max * 100 : 0}%` }} />
              </span>
            )}
          </>
        );
        return (
          <li key={href ?? name}>
            {href ? <a href={href} aria-label={`${rowName}, ${rowValue}`}>{content}</a> : content}
          </li>
        );
      })}
    </ol>
  );
}
