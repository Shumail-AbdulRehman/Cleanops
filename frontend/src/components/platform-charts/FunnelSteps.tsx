import { useLanguage } from '@/i18n/context';
import './shape-charts.css';

interface FunnelStepsProps {
  label: string;
  steps: readonly { label: string; count: number | null }[];
}

export function FunnelSteps({ label, steps }: FunnelStepsProps) {
  const { t } = useLanguage();
  const first = steps[0]?.count ?? 0;
  return (
    <ol className="px-shape-list px-funnel" role="list" aria-label={t(label)}>
      {steps.map(({ label: stepLabel, count }, index) => {
        const previous = steps[index - 1]?.count;
        const share = count !== null && previous && previous > 0
          ? `${Math.round(count / previous * 100)}%`
          : null;
        return (
          <li key={stepLabel}>
            <span className="px-shape-row">
              <span>{t(stepLabel)}</span>
              <strong>{count ?? t('Not available')}</strong>
              {index > 0 && (
                <span className="px-funnel-share">
                  {share ?? t('Not available')}
                  <span className="sr-only">{` ${t('of the previous step')}`}</span>
                </span>
              )}
            </span>
            {count !== null && first > 0 && (
              <span className="px-funnel-bar" aria-hidden="true"
                style={{ width: `${Math.min(count / first * 100, 100)}%` }} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
