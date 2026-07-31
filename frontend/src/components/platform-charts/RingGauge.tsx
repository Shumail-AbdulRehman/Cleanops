import { useLanguage } from '@/i18n/context';
import './shape-charts.css';

interface RingGaugeProps {
  label: string;
  share: number | null;
  tone?: 'good' | 'blue';
  size?: number;
}

export function RingGauge({ label, share, tone = 'good', size = 96 }: RingGaugeProps) {
  const { t } = useLanguage();
  const percentage = share === null ? null : Math.min(100, Math.max(0, share));
  const value = percentage === null ? t('Not available') : `${Math.round(percentage)}%`;

  return (
    <svg className="px-ring-gauge" viewBox="0 0 100 100" width={size} height={size}
      data-tone={tone} role="img" aria-label={`${t(label)}: ${value}`}>
      <circle className="px-ring-track" cx="50" cy="50" r="44" />
      {percentage !== null && percentage > 0 && (
        <circle className="px-ring-value" cx="50" cy="50" r="44" pathLength="100"
          strokeDasharray={`${percentage} 100`} transform="rotate(-90 50 50)" />
      )}
      <text x="50" y="50" dominantBaseline="central" fontSize={percentage === null ? 10 : 18}>
        {value}
      </text>
    </svg>
  );
}
