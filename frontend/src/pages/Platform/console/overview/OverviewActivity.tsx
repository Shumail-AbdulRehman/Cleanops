import { useId, type ReactNode } from 'react';
import { CalendarHeatmap } from '@/components/platform-charts/CalendarHeatmap';
import { FunnelSteps } from '@/components/platform-charts/FunnelSteps';
import { RankedBars } from '@/components/platform-charts/RankedBars';
import { RingGauge } from '@/components/platform-charts/RingGauge';
import { StatusStackBar } from '@/components/platform-charts/StatusStackBar';
import { useLanguage } from '@/i18n/context';
import type { PlatformOverviewResponse, SubscriptionState } from '../api/consoleApi';
import { formatCount, NOT_AVAILABLE } from '../api/consoleFormat';
import './overview-activity.css';

type ActivityFields = Pick<PlatformOverviewResponse, 'funnel' | 'statusCounts' | 'tasksPerDay' | 'photos' | 'busiest'>;

interface OverviewActivityProps {
  data: { [Field in keyof ActivityFields]: ActivityFields[Field] | null } & Pick<PlatformOverviewResponse, 'system'>;
}

const subscriptionStates = [
  ['ACTIVE', 'Active'],
  ['PAST_DUE', 'Past due'],
  ['SCHEDULED_CANCEL', 'Scheduled to cancel'],
  ['CANCELLED', 'Cancelled'],
  ['NONE', 'Never paid'],
] as const satisfies readonly (readonly [SubscriptionState, string])[];

const webhookDateTime = new Intl.DateTimeFormat('en-PK', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Karachi',
});

function ActivityPanel({ title, subtitle, span = 3, total, children }: {
  title: string;
  subtitle: string;
  span?: 3 | 6;
  total?: number;
  children: ReactNode;
}) {
  const id = useId();
  const { t } = useLanguage();

  return (
    <section className={`px-panel px-overview-activity px-span-${span}`} aria-labelledby={id}>
      <header className="px-overview-activity-header">
        <div>
          <h2 id={id}>{t(title)}</h2>
          <p>{t(subtitle)}</p>
        </div>
        {total !== undefined && (
          <p className="px-overview-activity-total"><strong>{t(formatCount(total))}</strong> {t('tasks')}</p>
        )}
      </header>
      {children}
    </section>
  );
}

function ActivityMessage({ children }: { children: string }) {
  const { t } = useLanguage();
  return <p className="px-overview-activity-message">{t(children)}</p>;
}

function StatusItem({ label, tone, children }: {
  label: string;
  tone: 'good' | 'warn' | 'bad' | 'muted';
  children: ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <div>
      <dt><span className="px-overview-activity-dot" data-tone={tone} aria-hidden="true" />{t(label)}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function SystemStatus({ system }: { system: PlatformOverviewResponse['system'] }) {
  const id = useId();
  const { t } = useLanguage();
  const { database, lastWebhookAt, photoChecks } = system;
  const reachable = database === 'OK';
  const photoMode = photoChecks === null ? NOT_AVAILABLE
    : photoChecks ? 'On, owner switch (no privacy screening)' : 'Owner switch off';

  return (
    <section className="px-panel px-overview-system" aria-labelledby={id}>
      <h2 id={id}>{t('System status')}</h2>
      <dl>
        <StatusItem label="Database" tone={reachable ? 'good' : 'bad'}>
          {t(reachable ? 'Reachable' : 'Unavailable')}
        </StatusItem>
        <StatusItem label="Last Paddle webhook" tone={lastWebhookAt ? 'good' : 'muted'}>
          {lastWebhookAt
            ? <time dateTime={lastWebhookAt}>{t(webhookDateTime.format(new Date(lastWebhookAt)))}</time>
            : t('none received yet')}
        </StatusItem>
        <StatusItem label="Photo checks" tone={photoChecks ? 'warn' : 'muted'}>{t(photoMode)}</StatusItem>
      </dl>
    </section>
  );
}

export function OverviewActivity({ data }: OverviewActivityProps) {
  const { t } = useLanguage();
  const { funnel, statusCounts, tasksPerDay, photos, busiest, system } = data;
  const taskTotal = tasksPerDay?.reduce((sum, { count }) => sum + count, 0);
  const photoTotal = photos && photos.passed + photos.retake + photos.manager + photos.cleaning;

  return (
    <>
      <ActivityPanel title="From sign-up to paying" subtitle="All companies to date">
        {funnel === null ? <ActivityMessage>{NOT_AVAILABLE}</ActivityMessage>
          : funnel.signedUp === 0 ? <ActivityMessage>No sign-ups yet</ActivityMessage>
          : <FunnelSteps label="Company funnel" steps={[
            { label: 'Signed up', count: funnel.signedUp },
            { label: 'Completed checkout', count: funnel.checkedOut },
            { label: 'Still paying', count: funnel.paying },
            { label: 'Worked this week', count: funnel.workedThisWeek },
          ]} />}
      </ActivityPanel>
      <ActivityPanel title="Subscription status" subtitle="Every company">
        {statusCounts === null ? <ActivityMessage>{NOT_AVAILABLE}</ActivityMessage>
          : subscriptionStates.every(([state]) => statusCounts[state] === 0)
            ? <ActivityMessage>No subscriptions yet</ActivityMessage>
            : <>
              <StatusStackBar label="Subscription status breakdown" counts={statusCounts} />
              <ul className="px-overview-status-list" role="list" aria-label={t('Subscription states')}>
                {subscriptionStates.map(([state, label]) => (
                  <li key={state}>
                    <a href={`/platform/companies?subscription=${state}`}
                      aria-label={`${t(label)} ${t(formatCount(statusCounts[state]))}`}>
                      <span className="px-overview-activity-dot" data-state={state} aria-hidden="true" />
                      <span>{t(label)}</span>
                      <strong>{t(formatCount(statusCounts[state]))}</strong>
                      <span className="px-overview-status-arrow" aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            </>}
      </ActivityPanel>
      <ActivityPanel title="Work done on the platform" subtitle="Tasks completed per day, last 12 weeks"
        span={6} total={taskTotal || undefined}>
        {tasksPerDay === null ? <ActivityMessage>{NOT_AVAILABLE}</ActivityMessage>
          : taskTotal === 0 ? <ActivityMessage>No activity yet</ActivityMessage>
          : <CalendarHeatmap label="12-week task activity" unit="tasks"
            days={tasksPerDay.map(({ day, count }) => ({ date: day, count }))} />}
      </ActivityPanel>
      <ActivityPanel title="Photo checks" subtitle="Last 30 days, all companies">
        {photos === null ? <ActivityMessage>{NOT_AVAILABLE}</ActivityMessage>
          : !photoTotal ? <ActivityMessage>No photos yet</ActivityMessage>
          : <>
            <div className="px-overview-photo-pass">
              <RingGauge label="First-time pass rate" share={photos.passed / photoTotal * 100} />
              <p><strong>{t(formatCount(photos.passed))}</strong> {t('passed first time')}</p>
            </div>
            <RankedBars label="Other photo check results" formatValue={(value) => t(formatCount(value))} rows={[
              { name: 'Retake needed', value: photos.retake, tone: 'warn' },
              { name: 'Sent to a manager', value: photos.manager, tone: 'mid' },
              { name: 'Needs cleaning', value: photos.cleaning, tone: 'bad' },
            ]} />
          </>}
      </ActivityPanel>
      <ActivityPanel title="Busiest companies" subtitle="Tasks completed, last 30 days">
        {busiest === null ? <ActivityMessage>{NOT_AVAILABLE}</ActivityMessage>
          : busiest.length === 0 ? <ActivityMessage>No activity yet</ActivityMessage>
          : <RankedBars label="Company activity rankings" formatValue={(value) => t(formatCount(value))}
            rows={busiest.map(({ companyId, name, tasks }) => ({
              name, value: tasks, href: `/platform/companies/${companyId}`,
            }))} />}
      </ActivityPanel>
      <SystemStatus system={system} />
    </>
  );
}
