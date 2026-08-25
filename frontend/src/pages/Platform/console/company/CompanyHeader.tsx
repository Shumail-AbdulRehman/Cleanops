import { useId, useRef, useState } from 'react';
import { Ban, ExternalLink } from 'lucide-react';
import { StatusPill, type StatusPillTone } from '@/components/workspace/StatusPill';
import { useLanguage } from '@/i18n/context';
import type { CompanyDetail } from '../../companyApi';
import type { PlatformCompanyInsightsResponse } from '../api/consoleApi';
import { formatDate, formatDaysAgo, NOT_AVAILABLE } from '../api/consoleFormat';
import { SuspendDialog, type ConfirmedStatusChange } from './SuspendDialog';
import './company-header.css';

type Company = CompanyDetail['company'];

type CompanyHeaderProps = {
  detail: CompanyDetail;
  insights?: Pick<PlatformCompanyInsightsResponse, 'lastActiveAt' | 'paddle'> | null;
};

const planLabels: Record<string, string> = {
  STARTER: 'Starter plan',
  PRO: 'Pro plan',
  ADVANCED: 'Enterprise plan',
};

function subscriptionPill(subscription: CompanyDetail['subscription']): [string, StatusPillTone] {
  switch (subscription?.status.toLowerCase()) {
    case 'active':
      return subscription.scheduledChangeAction === 'cancel'
        ? ['Subscription scheduled to cancel', 'attention']
        : ['Subscription active', 'ok'];
    case 'trialing':
      return ['Subscription active', 'ok'];
    case 'past_due':
      return ['Subscription past due', 'attention'];
    case 'canceled':
      return ['Subscription cancelled', 'neutral'];
    default:
      return ['No subscription', 'neutral'];
  }
}

export function CompanyHeader({ detail, insights }: CompanyHeaderProps) {
  const { t } = useLanguage();
  const bannerId = useId();
  const banner = useRef<HTMLElement>(null);
  const actionButton = useRef<HTMLButtonElement>(null);
  const focusBanner = useRef(false);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [change, setChange] = useState<ConfirmedStatusChange | null>(null);
  const confirmation = change?.company.id === detail.company.id ? change : null;
  let company = detail.company;

  // A confirmed write is usable even if the follow-up read fails or lags.
  if (confirmation && confirmation.company.accountVersion > company.accountVersion) {
    company = {
      ...confirmation.company,
      suspendedAt: null,
      suspensionReason: confirmation.company.operationalStatus === 'SUSPENDED' ? confirmation.reason : null,
    };
  }

  const suspended = company.operationalStatus === 'SUSPENDED';
  const suspendedOn = formatDate(company.suspendedAt);
  const [subscriptionLabel, subscriptionTone] = subscriptionPill(detail.subscription);
  const paddleUrl = insights?.paddle?.customerUrl;

  function openDialog() {
    focusBanner.current = false;
    setSelectedCompany(company);
  }

  function confirmChange(result: ConfirmedStatusChange) {
    focusBanner.current = result.company.operationalStatus === 'SUSPENDED';
    setChange(result);
    setSelectedCompany(null);
  }

  function restoreFocus(event: Event) {
    event.preventDefault();
    const target = focusBanner.current ? banner.current ?? actionButton.current : actionButton.current;
    target?.focus();
  }

  return (
    <div className="px-company-header">
      {suspended && (
        <section
          ref={banner}
          tabIndex={-1}
          aria-labelledby={bannerId}
          className="px-company-banner"
          data-just-suspended={confirmation?.company.operationalStatus === 'SUSPENDED' || undefined}
        >
          <Ban aria-hidden="true" />
          <div className="px-company-banner__text">
            <strong id={bannerId}>
              {suspendedOn === NOT_AVAILABLE
                ? t('Account suspended')
                : t('Account suspended on {date}', { date: t(suspendedOn) })}
            </strong>
            {suspendedOn === NOT_AVAILABLE && (
              <p>{t('Suspension date · {date}', { date: t(NOT_AVAILABLE) })}</p>
            )}
            <p>{company.suspensionReason ?? t(NOT_AVAILABLE)}</p>
          </div>
          <button ref={actionButton} type="button" className="px-company-button" onClick={openDialog}>
            {t('Reactivate')}
          </button>
        </section>
      )}
      <div className="px-company-header__row">
        <div className="px-company-header__identity">
          <div className="px-company-header__pills">
            <StatusPill className="px-company-header__plan">{planLabels[company.plan] ?? NOT_AVAILABLE}</StatusPill>
            <StatusPill tone={subscriptionTone}>{subscriptionLabel}</StatusPill>
            <StatusPill tone={suspended ? 'bad' : 'ok'}>
              {suspended ? 'Account suspended' : 'Account active'}
            </StatusPill>
          </div>
          <p className="px-company-header__metadata">
            <span>{t('Company #{id}', { id: company.id })}</span>
            <span aria-hidden="true">·</span>
            <span>{t('Signed up {date}', { date: t(formatDate(company.createdAt)) })}</span>
            <span aria-hidden="true">·</span>
            <span>{t('Last active {date}', { date: t(formatDaysAgo(insights?.lastActiveAt ?? null)) })}</span>
          </p>
        </div>
        <div className="px-company-actions">
          {paddleUrl && (
            <a className="px-company-button" href={paddleUrl} target="_blank" rel="noopener">
              <ExternalLink aria-hidden="true" />
              {t('Open in Paddle')}
            </a>
          )}
          {!suspended && (
            <button
              ref={actionButton}
              type="button"
              className="px-company-button px-company-button--danger"
              onClick={openDialog}
            >
              <Ban aria-hidden="true" />
              {t('Suspend company')}
            </button>
          )}
        </div>
      </div>
      <p className="px-company-header__confirmation" role="status">
        {confirmation && t(confirmation.company.operationalStatus === 'SUSPENDED'
          ? '{company} is suspended.'
          : '{company} is active again.', { company: company.name })}
      </p>
      {selectedCompany?.id === company.id && (
        <SuspendDialog
          company={selectedCompany}
          onDismiss={() => setSelectedCompany(null)}
          onSuccess={confirmChange}
          onCloseAutoFocus={restoreFocus}
        />
      )}
    </div>
  );
}
