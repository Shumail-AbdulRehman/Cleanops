import { SkeletonChart, SkeletonLine, SkeletonMetrics, SkeletonRows } from '@/components/common/LoadingSkeleton';
import { useLanguage } from '@/i18n/context';
import { useConsoleOverview } from '../api/consoleQueries';
import { OverviewActivity } from './OverviewActivity';
import { OverviewAttention } from './OverviewAttention';
import { OverviewFigures } from './OverviewFigures';
import { OverviewRevenue } from './OverviewRevenue';
import './overview-page.css';

const skeletonPanels = [
  ['attention', 'px-span-4'],
  ['inquiries', 'px-span-4'],
  ['upgrades', 'px-span-4'],
  ['revenue', 'px-span-8', true],
  ['plans', 'px-span-4'],
  ['signups', 'px-span-6', true],
  ['funnel', 'px-span-3'],
  ['subscriptions', 'px-span-3'],
  ['activity', 'px-span-6', true],
  ['photos', 'px-span-3'],
  ['busiest', 'px-span-3'],
] as const;

function OverviewLoading() {
  const { t } = useLanguage();

  return (
    <div className="px-grid px-overview-page" role="status" aria-label={t('Loading Overview…')} aria-busy="true">
      <div className="px-overview-figures" aria-hidden="true">
        <SkeletonMetrics count={5} />
      </div>
      {skeletonPanels.map(([panel, span, chart]) => (
        <div key={panel} className={span} data-skeleton-panel={panel} aria-hidden="true">
          {chart ? <SkeletonChart /> : <div className="px-panel"><SkeletonRows count={3} /></div>}
        </div>
      ))}
      <div className="px-panel px-overview-notice" aria-hidden="true">
        <SkeletonLine width="short" />
      </div>
    </div>
  );
}

export function OverviewPage() {
  const { t } = useLanguage();
  const overview = useConsoleOverview();

  if (overview.isPending) return <OverviewLoading />;

  if (!overview.data) {
    return (
      <div className="px-panel px-overview-error">
        <div role="alert">
          <h2>{t('Platform data could not load')}</h2>
          <p>{t('Nothing was changed. Try again to reload the overview.')}</p>
        </div>
        <button type="button" disabled={overview.isFetching} onClick={() => void overview.refetch()}>
          {t(overview.isFetching ? 'Retrying…' : 'Retry')}
        </button>
      </div>
    );
  }

  const {
    figures, months, checkinsPerDay, attention, upgrades, plans,
    funnel, statusCounts, tasksPerDay, photos, busiest, system,
  } = overview.data;

  return (
    <div className="px-grid px-overview-page">
      {figures.companies === 0 && (
        <div className="px-panel px-overview-notice px-overview-empty">
          <h2>{t('No companies yet')}</h2>
          <p>{t('Companies appear here after their owners sign up.')}</p>
        </div>
      )}
      <OverviewFigures figures={figures} months={months} checkinsPerDay={checkinsPerDay} />
      <OverviewAttention attention={attention} upgrades={upgrades} />
      <OverviewRevenue figures={figures} months={months} plans={plans} />
      <OverviewActivity data={{ funnel, statusCounts, tasksPerDay, photos, busiest, system }} />
    </div>
  );
}

export default OverviewPage;
