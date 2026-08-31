import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import useAuth from '@/hooks/useAuth';
import { useLanguage } from '@/i18n/context';
import PageHeader from '@/components/common/PageHeader';
import { SkeletonLine, SkeletonRows } from '@/components/common/LoadingSkeleton';
import SetupPath, { buildSetupSteps } from '@/components/onboarding/SetupPath';
import SelectMenu from '@/components/workspace/SelectMenu';
import OperationsState from '../Manager/OperationsState';
import { getBillingLifecycle } from '../Subscription/api';
import { getSetupReadiness } from './api';
import './setup-v6.css';

function errorStatus(error: unknown) {
  return (error as { response?: { status?: number } })?.response?.status;
}

export default function SetupPage() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [params, setParams] = useSearchParams();
  const owner = user?.role === 'ADMIN';
  const operational = owner || user?.role === 'MANAGER';
  const cursor = Number(params.get('afterId') ?? 0);
  const afterId = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
  const scope = [user?.companyId, user?.role, user?.id];
  const readiness = useQuery({
    queryKey: ['setup-readiness', ...scope, afterId],
    queryFn: ({ signal }) => getSetupReadiness(afterId, signal),
    enabled: operational,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const billing = useQuery({
    queryKey: ['billing-lifecycle', ...scope],
    queryFn: ({ signal }) => getBillingLifecycle(signal),
    enabled: owner,
    staleTime: 0,
  });
  // Retain saved progress during refresh failures, but fail closed on new work.
  const data = readiness.data;
  const manageWork = readiness.isError ? undefined : data?.access?.manageWork;
  const canManage = manageWork === true;
  const selected = data?.sites.find(site => String(site.id) === params.get('site')) ?? data?.sites[0];
  const teamLink = selected ? `/staff?locationId=${selected.id}` : '/staff';
  const steps = buildSetupSteps({ selected, owner, manageWork });
  const completed = steps.filter(step => step.done).length;
  const changePage = (value: number) => setParams(previous => {
    const result = new URLSearchParams(previous);
    result.set('afterId', String(value));
    result.delete('site');
    return result;
  });
  let refreshed = '';
  if (selected && data && Number.isFinite(Date.parse(data.asOf))) {
    refreshed = new Intl.DateTimeFormat(language === 'ur' ? 'ur-PK' : 'en-PK', {
      timeZone: selected.timezone, dateStyle: 'medium', timeStyle: 'short',
    }).format(new Date(data.asOf));
  }

  if (!operational) return <p role="alert">{t('Owner or assigned-site manager access is required.')}</p>;

  return (
    <div className="wx-setup">
      <PageHeader title={owner ? 'Get your company ready' : 'Prepare your assigned locations'}
        subtitle="A short path from a new location to the first working shift."
        action={<Link className="wx-setup-button wx-setup-button--ghost" to="/dashboard">{t('Open overview')}</Link>} />
      <div className="wx-setup-layout">
        <section className="wx-setup-panel wx-setup-checklist" aria-labelledby="setup-heading">
          <div className="wx-setup-heading">
            <h2 id="setup-heading">{t('Your setup checklist')}</h2>
            {data && (selected || !data.totalLocations) && (
              <strong>{t('{count} of 4 configured', { count: completed })}</strong>
            )}
          </div>
          {data && (selected || !data.totalLocations) && (
            <div className="wx-setup-progress">
              <progress max={4} value={completed} aria-label={t('Saved setup for this location')} />
              <p>{t('Progress comes from saved locations, staff shifts, areas and schedules.')} <bdi>{new Intl.NumberFormat(language === 'ur' ? 'ur-PK' : 'en-PK', { style: 'percent' }).format(completed / 4)}</bdi></p>
            </div>
          )}
          <div className="wx-setup-toolbar">
            {selected && data && (
              <div className="wx-setup-site">
                <span>{t('Setup for location')}</span>
                <SelectMenu label="Setup for location" value={String(selected.id)}
                  options={data.sites.map(site => ({ value: String(site.id), label: site.name, translateLabel: false }))}
                  onChange={value => setParams(previous => {
                    const result = new URLSearchParams(previous);
                    result.set('site', value);
                    return result;
                  })} />
                <p><bdi>{selected.timezone}</bdi>{refreshed && <> · {t('Checked')} <bdi>{refreshed}</bdi></>}</p>
              </div>
            )}
            <button type="button" className="wx-setup-button" disabled={readiness.isFetching} aria-busy={readiness.isFetching} onClick={() => void readiness.refetch()}>
              <RefreshCw size={16} aria-hidden="true" />{t('Refresh status')}
            </button>
          </div>
          {readiness.isPending && (
            <div role="status" aria-busy="true" className="wx-setup-loading">
              <span>{t('Loading setup status…')}</span>
              <div aria-hidden="true"><SkeletonRows count={4} /></div>
            </div>
          )}
          {readiness.isError && (
            <div className="wx-setup-notice wx-setup-notice--error" role="alert">
              <h3>{t(errorStatus(readiness.error) === 403 ? 'Setup access is restricted' : 'Setup status could not load')}</h3>
              <p>{t(errorStatus(readiness.error) === 403
                ? 'Ask your company owner about workspace access. Existing account security and owner billing remain available.'
                : 'Check your connection and refresh. Your saved setup has not changed.')}</p>
              <button type="button" className="wx-setup-button" disabled={readiness.isFetching} aria-busy={readiness.isFetching} onClick={() => void readiness.refetch()}>{t('Try again')}</button>
            </div>
          )}
          <OperationsState />
          {data && (
            <>
              {!canManage && (
                <p role="status" className="wx-setup-notice">{t(manageWork !== false ? 'New-work access is unavailable'
                  : owner ? 'This workspace is read-only for new work. Review plan activation to add or change setup.'
                    : 'This workspace is read-only for new work. Ask your company owner to review plan activation.')}</p>
              )}
              {!selected && (
                <div className="wx-setup-empty">
                  <h3>{t(data.totalLocations ? 'No locations on this page' : owner ? 'No locations yet' : 'No assigned locations yet')}</h3>
                  <p>{t(data.totalLocations ? 'Return to the first page to choose a location.'
                    : owner ? 'Create a location to begin. Nothing is marked complete until it is saved.'
                      : 'Ask your owner to assign a location before setting up its team or schedules.')}</p>
                </div>
              )}
              {(selected || !data.totalLocations) && (
                <>
                  <SetupPath steps={steps} />
                  {selected && completed === 4 && <p className="wx-setup-ready" role="status">{t('Setup is configured for this location. Open Today to inspect its work.')}</p>}
                  {selected && (
                    <div className="wx-setup-followup">
                      <Link className="wx-setup-button" to={`/today-status?locationId=${selected.id}&date=today`}>{t('Open Today')}</Link>
                      {canManage && <Link className="wx-setup-button wx-setup-button--ghost" to={teamLink + '&create=1'}>{t('Add staff')}</Link>}
                    </div>
                  )}
                </>
              )}
              <div className="wx-setup-pagination">
                <span>{t('Showing {count} of {total} locations', { count: data.sites.length, total: data.totalLocations })}</span>
                <div>
                  {afterId > 0 && <button type="button" className="wx-setup-button" onClick={() => changePage(0)}>{t('First locations')}</button>}
                  {data.nextCursor !== null && <button type="button" className="wx-setup-button" onClick={() => changePage(data.nextCursor!)}>{t('More locations')}</button>}
                </div>
              </div>
            </>
          )}
        </section>
        <aside className="wx-setup-aside" aria-label={t('Setup guidance')}>
          {owner && (
            <section className="wx-setup-panel wx-setup-guidance">
              <h2>{t('Account readiness')}</h2>
              {billing.isPending && <div role="status" aria-busy="true"><p>{t('Checking account readiness…')}</p><div aria-hidden="true" className="wx-setup-account-skeleton"><SkeletonLine width="long" /><SkeletonLine width="full" /></div></div>}
              {billing.isError && (
                <div role="alert">
                  <p>{t('Account readiness could not load. Setup progress is shown separately.')}</p>
                  <button type="button" className="wx-setup-button" disabled={billing.isFetching} aria-busy={billing.isFetching} onClick={() => void billing.refetch()}>{t('Try again')}</button>
                </div>
              )}
              {billing.data && (
                <>
                  <dl>
                    <div><dt>{t('Owner email')}</dt><dd>{t(billing.data.ownerVerified ? 'Verified' : 'Not verified')}</dd></div>
                    <div><dt>{t('Plan activation')}</dt><dd>{t(readiness.isPending ? 'Checking new-work access…'
                      : typeof manageWork !== 'boolean' ? 'New-work access is unavailable'
                        : canManage ? 'New work is available' : 'Review plan activation')}</dd></div>
                  </dl>
                  {!billing.data.ownerVerified && <p>{t('Verify your email before activating a new plan.')}</p>}
                  {!billing.data.billingConfigured && <p>{t('Billing service is currently unavailable. Existing records remain saved.')}</p>}
                  <div className="wx-setup-guidance-links">
                    <Link to="/settings">{t('Account settings')}</Link>
                    <Link to="/subscription">{t('Plan & billing')}</Link>
                  </div>
                </>
              )}
            </section>
          )}
          <section className="wx-setup-panel wx-setup-guidance">
            <h2>{t('Before the first shift')}</h2>
            <p>{t('Daily schedules include every day, including weekends. Dates and times follow each location’s timezone.')}</p>
            <p>{t('Each task QR belongs to a generated task. A room code cannot start another task.')}</p>
            <p>{t('Use only the approved Android app link shared by your company owner.')}</p>
          </section>
          {selected && selected.counts.unassignedTasksToday > 0 && (
            <section className="wx-setup-panel wx-setup-guidance wx-setup-guidance--attention">
              <h2>{t('Unassigned work')}</h2>
              <p>{t('{count} tasks have no assigned worker.', { count: selected.counts.unassignedTasksToday })}</p>
              <p>{t(selected.counts.staffWithShift ? 'Check staff availability and the cleaning schedule. A replacement is not guaranteed.'
                : 'No staff shift is configured for this location. Add or update a shift before assigning work.')}</p>
              <Link to={`/today-status?locationId=${selected.id}&date=today&tab=tasks&status=unassigned`}>{t('Review unassigned tasks')}</Link>
              <Link to={teamLink}>{t('Open team and shifts')}</Link>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
