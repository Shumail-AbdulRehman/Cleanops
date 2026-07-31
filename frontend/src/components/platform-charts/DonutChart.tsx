import { useLanguage } from '@/i18n/context';
import './shape-charts.css';

export type PlanChartTone = 'starter' | 'pro' | 'enterprise';

interface DonutChartProps {
  label: string;
  parts: readonly { label: string; value: number | null; tone: PlanChartTone }[];
  centerValue?: number | string | null;
  centerCaption?: string;
  formatValue?: (value: number) => string;
}

const radius = 54;
const circumference = 2 * Math.PI * radius;

export function DonutChart({
  label, parts, centerValue, centerCaption = 'Total', formatValue = String,
}: DonutChartProps) {
  const { t } = useLanguage();
  const describe = (value: number | null) => value === null ? t('Not available') : formatValue(value);
  const positiveParts = parts.filter((part) => part.value !== null && part.value > 0);
  const total = positiveParts.reduce((sum, part) => sum + (part.value ?? 0), 0);
  const gap = positiveParts.length > 1 ? 2 : 0;
  const availableLength = circumference - positiveParts.length * gap;
  const displayedValue = centerValue === undefined
    ? describe(parts.some((part) => part.value === null) ? null : total)
    : typeof centerValue === 'string' ? centerValue : describe(centerValue);
  const summary = parts.map((part) => `${t(part.label)} ${describe(part.value)}`).join(', ');
  const segments = [];
  let offset = 0;
  for (const part of positiveParts) {
    const length = (part.value ?? 0) / total * availableLength;
    segments.push({ part, length, offset });
    offset += length + gap;
  }

  return (
    <svg className="px-donut-chart" viewBox="0 0 128 128" role="img"
      aria-label={summary ? `${t(label)}: ${summary}` : t(label)}>
      {segments.map(({ part, length, offset: start }) => (
        <circle key={part.label} data-tone={part.tone} cx="64" cy="64" r={radius}
          transform="rotate(-90 64 64)" strokeDasharray={`${length} ${circumference - length}`}
          strokeDashoffset={-start}>
          <title>{`${t(part.label)}: ${describe(part.value)}`}</title>
        </circle>
      ))}
      <text x="64" y="62" className="px-donut-value"
        fontSize={displayedValue.length > 7 ? 11 : 26}>{displayedValue}</text>
      <text x="64" y="80" className="px-donut-caption">{t(centerCaption)}</text>
    </svg>
  );
}
