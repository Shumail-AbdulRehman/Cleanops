import { useQuery } from '@tanstack/react-query';
import { Ban, ChevronRight, Clock, CreditCard, Mail, TrendingUp, type LucideIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/i18n/context';
import { operatorQueryScope } from '../../operatorSession';
import { getInquiries } from '../../serviceApi';
import type { PlanCode, PlatformOverviewResponse } from '../api/consoleApi';
import { formatCount, formatDate, formatMoney } from '../api/consoleFormat';
import './overview-attention.css';

export type OverviewAttentionProps = Pick<PlatformOverviewResponse, 'attention' | 'upgrades'>;

const attentionKinds = {
  PAST_DUE: { label: 'Payment past due', icon: CreditCard, tone: 'attention' },
  SUSPENDED: { label: 'Account suspended', icon: Ban, tone: 'danger' },
  SCHEDULED_CANCEL: { label: 'Scheduled to cancel', icon: Clock, tone: 'warning' },
} as const;

const planLabels: Record<PlanCode, string> = { STARTER: 'Starter', PRO: 'Pro', ADVANCED: 'Enterprise' };
const upgradePreviewSize = 3;

function AttentionLink({ to, children, label }: { to: string; children: ReactNode; label?: string }) {
  return (
    <Link className="px-attention-link" to={to} aria-label={label}>
      {children}
      <ChevronRight size={16} aria-hidden="true" />
    </Link>
  );
}

function AttentionRow({ name, detail, icon: Icon, tone, to, action }: {
  name: string;
  detail: string;
  icon: LucideIcon;
  tone: 'attention' | 'danger' | 'warning' | 'plan';
  to: string;
  action: 'Open' | 'Reply';
}) {
  const { t } = useLanguage();
  const label = t(action === 'Open' ? 'Open {company}' : 'Reply to {company}', { company: name });

  return (
    <li className="px-attention-row">
      <span className="px-attention-mark" data-tone={tone}><Icon size={18} aria-hidden="true" /></span>
      <div>
        <strong><bdi>{name}</bdi></strong>
        <p>{detail}</p>
      </div>
      <AttentionLink to={to} label={label}>{t(action)}</AttentionLink>
    </li>
  );
}

export function OverviewAttention({ attention, upgrades }: OverviewAttentionProps) {
  const { t } = useLanguage();
  const id = useId();
  const inquiries = useQuery({
    queryKey: [...operatorQueryScope, 'inquiries', ''],
    queryFn: ({ signal }) => getInquiries({}, signal),
    retry: false,
  });
  const newInquiries = inquiries.data?.items.filter(({ handling }) => handling.status === 'NEW') ?? [];
  const moreUpgrades = upgrades.length - upgradePreviewSize;

  return (
    <div className="px-overview-attention">
      <section className="px-attention-panel" aria-labelledby={`${id}-needs`}>
        <h2 id={`${id}-needs`}>{t('Needs attention')}</h2>
        {attention.items.length > 0 ? (
          <ul className="px-attention-list">
            {attention.items.map(({ companyId, name, kind, plan, date }) => {
              const { label, icon, tone } = attentionKinds[kind];
              return (
                <AttentionRow key={`${companyId}-${kind}`} name={name} icon={icon} tone={tone}
                  detail={t('{reason} · {plan} · {date}', {
                    reason: t(label), plan: t(planLabels[plan]), date: t(formatDate(date)),
                  })}
                  to={`/platform/companies/${companyId}`} action="Open" />
              );
            })}
          </ul>
        ) : <p className="px-attention-message">{t('No companies need attention right now.')}</p>}
        <div className="px-attention-risk">
          <span>{t('Monthly revenue at risk')}</span>
          <strong>{t(formatMoney(attention.mrrAtRisk))}</strong>
        </div>
      </section>

      <section className="px-attention-panel" aria-labelledby={`${id}-inquiries`}>
        <h2 id={`${id}-inquiries`}>{t('Enterprise inquiries')}</h2>
        {inquiries.isPending ? (
          <p className="px-attention-message" role="status">{t('Loading inquiries…')}</p>
        ) : inquiries.isError && !inquiries.data ? (
          <div className="px-attention-message">
            <p role="alert">{t('Unable to load inquiries.')}</p>
            <button className="px-attention-link" type="button" onClick={() => void inquiries.refetch()}>{t('Retry')}</button>
          </div>
        ) : newInquiries.length > 0 ? (
          <ul className="px-attention-list">
            {newInquiries.map(({ id, company, requestedLocations, requestedStaff, createdAt }) => (
              <AttentionRow key={id} name={company} icon={Mail} tone="attention"
                detail={t('{locations} locations · {staff} staff · {date}', {
                  locations: formatCount(requestedLocations), staff: formatCount(requestedStaff), date: t(formatDate(createdAt)),
                })}
                to={`/platform/inquiries?${new URLSearchParams({ inquiry: id })}`} action="Reply" />
            ))}
          </ul>
        ) : <p className="px-attention-message">{t('No new inquiries are waiting for a reply.')}</p>}
        <footer><AttentionLink to="/platform/inquiries">{t('All inquiries')}</AttentionLink></footer>
      </section>

      <section className="px-attention-panel" aria-labelledby={`${id}-limits`}>
        <h2 id={`${id}-limits`}>{t('Close to plan limit')}</h2>
        {upgrades.length > 0 ? (
          <ul className="px-attention-list">
            {upgrades.slice(0, upgradePreviewSize).map(({ companyId, name, plan, staff, staffLimit }) => (
              <AttentionRow key={companyId} name={name} icon={TrendingUp} tone="plan"
                detail={t('{staff} of {limit} staff on {plan}', {
                  staff: formatCount(staff), limit: formatCount(staffLimit), plan: t(planLabels[plan]),
                })}
                to={`/platform/companies/${companyId}`} action="Open" />
            ))}
          </ul>
        ) : <p className="px-attention-message">{t('No companies are close to their staff limit.')}</p>}
        {moreUpgrades > 0 && (
          <footer>
            <AttentionLink to="/platform/companies">{t('{count} more in Companies', { count: formatCount(moreUpgrades) })}</AttentionLink>
          </footer>
        )}
      </section>
    </div>
  );
}
