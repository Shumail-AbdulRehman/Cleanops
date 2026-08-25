import { createContext, useContext } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useLocation, useParams } from 'react-router-dom';
import { CHART_PLANS } from '@/components/platform-charts/chartScale';
import { useLanguage } from '@/i18n/context';
import { getCompany, type CompanyDetail } from '../../companyApi';
import { operatorQueryScope } from '../../operatorSession';
import { NOT_AVAILABLE } from '../api/consoleFormat';
import { useConsoleCompanyInsights } from '../api/consoleQueries';
import ConsoleShell, { type ConsoleShellProps } from '../shell/ConsoleShell';
import { CompanyHeader } from './CompanyHeader';
import { CompanyAccountPanel, CompanyHistoryPanel, CompanyPaymentsPanel, CompanySubscriptionPanel } from './CompanyRecordPanels';
import { CompanyActivityPanel, CompanyQualityPanel, CompanyUsagePanel } from './CompanyUsagePanels';
import './company-page.css';

const companiesPath = '/platform/companies';
const DetailContext = createContext<{ id: number | null; query: UseQueryResult<CompanyDetail> } | null>(null);

type BrowserNavigation = {
  currentEntry: { index: number } | null;
  entries: () => { url: string | null }[];
};

function previousCompanySearch(): string {
  const { navigation } = window as Window & { navigation?: BrowserNavigation };
  const index = navigation?.currentEntry?.index ?? 0;
  if (index <= 0) return '';

  const previous = navigation?.entries()[index - 1]?.url;
  if (!previous) return '';

  const url = new URL(previous);
  return url.origin === window.location.origin && url.pathname === companiesPath ? url.search : '';
}

function responseStatus(error: Error | null) {
  return error && 'status' in error ? error.status : null;
}

function accessLost(status: unknown) {
  return status === 401 || status === 403 || status === 404;
}

export function CompanyDetailLayout({ operatorEmail }: Pick<ConsoleShellProps, 'operatorEmail'>) {
  const { id: routeId } = useParams();
  const { search } = useLocation();
  const candidate = Number(routeId);
  const id = routeId && /^[1-9]\d{0,9}$/.test(routeId) && candidate <= 2_147_483_647 ? candidate : null;
  const query = useQuery({
    queryKey: [...operatorQueryScope, 'company', id],
    queryFn: ({ signal }) => getCompany(id!, signal),
    enabled: id !== null,
    retry: false,
  });
  const backLink = { to: companiesPath + (search || previousCompanySearch()), label: 'Companies' };
  const title = accessLost(responseStatus(query.error)) ? undefined : query.data?.company.name;

  return (
    <DetailContext.Provider value={{ id, query }}>
      <ConsoleShell title={title ?? 'Company details'} backLink={backLink} operatorEmail={operatorEmail} />
    </DetailContext.Provider>
  );
}

function CompanyNotFound() {
  const { t } = useLanguage();
  return <p className="px-company-message" role="status">{t('Company not found.')}</p>;
}

function CompanyRecords({ id, detail }: { id: number; detail: UseQueryResult<CompanyDetail> }) {
  const { t } = useLanguage();
  const insights = useConsoleCompanyInsights(id);
  const statuses = [responseStatus(detail.error), responseStatus(insights.error)];
  if (statuses.includes(404)) return <CompanyNotFound />;

  function retry() {
    if (detail.isError) void detail.refetch();
    if (insights.isError) void insights.refetch();
  }

  const retrying = (detail.isError && detail.isFetching) || (insights.isError && insights.isFetching);
  const errorNotice = (detail.isError || insights.isError) && (
    <div className="px-company-message">
      <p role="alert">{t('Company details could not be loaded.')}</p>
      <button className="px-company-button" type="button" disabled={retrying} onClick={retry}>
        {t('Retry')}
      </button>
    </div>
  );

  if (!detail.data || !insights.data) {
    return errorNotice || (
      <div className="px-company-page-skeleton" role="status" aria-label={t('Loading company details')}>
        <div aria-hidden="true" />
        <div aria-hidden="true" />
        <div aria-hidden="true" />
      </div>
    );
  }
  if (statuses.some(accessLost)) return errorNotice;

  const record = detail.data;
  const { company } = record;
  const { owner, limits, usage, lastActiveAt, activity30, calendar35, photos, onTimeShare, payments, paidToDate, paddle } = insights.data;
  const plan = CHART_PLANS.find(code => code === company.plan);

  return (
    <div className="px-company-detail">
      {errorNotice}
      <CompanyHeader key={id} detail={record} insights={insights.data} />
      <div className="px-company-detail__columns">
        <div>
          {plan ? <CompanyUsagePanel plan={plan} usage={usage} limits={limits} /> : (
            <section className="px-company-record">
              <h2>{t('Usage against plan')}</h2>
              <p>{t(NOT_AVAILABLE)}</p>
            </section>
          )}
          <CompanyActivityPanel key={id} activity30={activity30} calendar35={calendar35} lastActiveAt={lastActiveAt} />
          <CompanyPaymentsPanel payments={payments} paidToDate={paidToDate} />
        </div>
        <div>
          <CompanyAccountPanel company={company} owner={owner} />
          <CompanySubscriptionPanel detail={record} paddle={paddle} />
          <CompanyQualityPanel photos={photos} onTimeShare={onTimeShare} lastActiveAt={lastActiveAt} />
          <CompanyHistoryPanel company={company} activity={record.activity} />
        </div>
      </div>
    </div>
  );
}

export function CompanyDetailPage() {
  const context = useContext(DetailContext);
  if (!context) throw new Error('CompanyDetailPage requires CompanyDetailLayout');
  if (context.id === null) return <CompanyNotFound />;
  return <CompanyRecords id={context.id} detail={context.query} />;
}

export default CompanyDetailPage;
