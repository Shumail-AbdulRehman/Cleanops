import { useLanguage } from '@/i18n/context';
import './shape-charts.css';

const states = [
  ['ACTIVE', 'Active', 'active'],
  ['PAST_DUE', 'Past due', 'past-due'],
  ['SCHEDULED_CANCEL', 'Scheduled to cancel', 'ending'],
  ['CANCELLED', 'Cancelled', 'cancelled'],
  ['NONE', 'Never paid', 'never'],
] as const;

interface StatusStackBarProps {
  label: string;
  counts: Partial<Record<typeof states[number][0], number | null>>;
}

export function StatusStackBar({ label, counts }: StatusStackBarProps) {
  const { t } = useLanguage();
  const summary: string[] = [];
  const segments = states.map(([state, name, tone]) => {
    const count = counts[state];
    if (count === null) {
      summary.push(`${t(name)} ${t('Not available')}`);
    }
    if (count === undefined || count === null || count <= 0) return null;
    const segmentLabel = `${t(name)} ${count}`;
    summary.push(segmentLabel);
    return <span key={state} data-tone={tone} style={{ flexGrow: count }} title={segmentLabel} />;
  });

  return (
    <div className="px-status-stack" role="img"
      aria-label={`${t(label)}: ${summary.join(', ') || t('No subscriptions')}`}>
      {segments}
    </div>
  );
}
