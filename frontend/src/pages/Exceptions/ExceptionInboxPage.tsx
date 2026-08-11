import { useId, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Camera, CheckCircle2, MapPin, SlidersHorizontal } from 'lucide-react';
import type { RootState } from '@/store/store';
import { client } from '@/api/client';
import { useLanguage } from '@/i18n/context';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import PageHeader from '@/components/common/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import Pagination from '@/components/common/Pagination';
import FindField from '@/components/workspace/FindField';
import SelectMenu from '@/components/workspace/SelectMenu';
import DateMenu from '@/components/workspace/DateMenu';
import StatusPill from '@/components/workspace/StatusPill';
import WorkspaceTabs, { WorkspaceTabPanel } from '@/components/workspace/WorkspaceTabs';
import OperationsState from '../Manager/OperationsState';
import { localTime } from '../Manager/operations';
import { useAreas } from '../Area/queries';
import { plainReason } from '../Verification/presentation';
import { useException } from './queries';
import ReviewDetail from './ReviewDetail';
import type { VerificationException } from './types';
import './review-workspace.css';
import './reviews-v6.css';

type ReviewPage = {
  cases: VerificationException[]; page: number; pageSize: number; total: number; totalPages: number;
  locations: Array<{ id: number; name: string; timezone: string }>;
  queueCounts: Record<string, number>;
};
type UpdateFilters = (values: Record<string, string>) => void;
const FILTERS = ['locationId', 'areaId', 'queue', 'period', 'date', 'q', 'page', 'pageSize', 'reasonCode'];
const QUEUES = [['needs-me', 'Pending'], ['resolved', 'Reviewed'], ['staff', 'Waiting for staff'], ['service', 'Checks pending']];
const PERIODS = [['all', 'All dates'], ['today', 'Today'], ['earlier', 'Earlier work'], ['date', 'Specific date']];

export default function ExceptionInboxPage() {
  const { t, language } = useLanguage();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const user = useSelector((s: RootState) => s.auth.user);
  const scope = `${user?.companyId}:${user?.role}:${user?.id}`;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const rawId = useParams().id;
  const id = rawId ? Number(rawId) : undefined;
  const returnValue = params.get('returnTo');
  const source = rawId && returnValue?.startsWith('/exceptions?')
    ? new URLSearchParams(returnValue.slice('/exceptions?'.length)) : params;
  const filters = Object.fromEntries(FILTERS.map(key => [key, source.get(key) ?? '']).filter(([, value]) => value));
  filters.queue ??= source.get('state') === 'RESOLVED' ? 'resolved'
    : source.get('state') === 'WAITING_SERVICE' ? 'service'
    : source.get('state') === 'STAFF_ACTION_REQUIRED' ? 'staff' : 'needs-me';
  filters.page ??= '1';
  const search = useDebouncedValue(filters.q ?? '');
  const applied = { ...filters, q: search };
  const query = useQuery({
    queryKey: ['review-page', scope, applied],
    queryFn: async ({ signal }) => (await client.get<{ data: ReviewPage }>('/verification-exceptions', { params: applied, signal })).data.data,
    refetchInterval: 30000, refetchOnWindowFocus: true,
  });
  // Preserve the existing fail-closed queue behavior after a failed authorization/read.
  // The mounted case owns its own availability and decision-draft protection.
  const data = query.isError ? undefined : query.data;
  const areas = useAreas(Number(filters.locationId));
  const returnTo = '/exceptions?' + new URLSearchParams(filters);
  function update(values: Record<string, string>) {
    const next = new URLSearchParams(filters);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    if (!('page' in values)) next.delete('page');
    if ('locationId' in values) next.delete('areaId');
    navigate('/exceptions?' + next, { preventScrollReset: true });
  }
  if (rawId && (!Number.isSafeInteger(id) || !id || id < 1)) return <p role="alert">{t('Review unavailable.')}</p>;
  const queueLabel = (label: string) => language === 'ur' && ['Pending', 'Reviewed'].includes(label) ? label.toLowerCase() : label;
  return <div className="wx-reviews">
    <PageHeader title="Photo Reviews" subtitle="The evidence, the context, and a clear next decision." tools={<>
      <SelectMenu label="Location" value={filters.locationId ?? ''} icon={<MapPin />} onChange={value => update({ locationId: value })}
        options={[{ value: '', label: 'All locations' }, ...(data?.locations ?? []).map(site => ({ value: String(site.id), label: site.name, translateLabel: false }))]} />
      <SelectMenu label="Period" value={filters.period ?? 'all'} icon={<CalendarDays />} onChange={value => update({ period: value })}
        options={PERIODS.map(([value, label]) => ({ value, label }))} />
      {filters.period === 'date' && <DateMenu label="Local date" value={filters.date === 'today' ? '' : filters.date ?? ''}
        quickOptions={[]} onChange={value => update({ date: value })} />}
    </>} />
    <ReviewPanels key={scope} selectionKey={JSON.stringify(applied)} data={data} selectedId={id} returnTo={returnTo}
      filters={filters} onUpdate={update} loading={query.isPending} error={query.error} retry={() => void query.refetch()}
      returnState={location.state as { scrollY?: number; focusId?: number } | null}
      filterPanel={<ReviewFilters open={filtersOpen} onOpenChange={setFiltersOpen} filters={filters} areas={areas.data ?? []} areasLoading={areas.isPending && !!filters.locationId}
        locations={data?.locations ?? []} areasError={areas.error} retryAreas={() => void areas.refetch()} onUpdate={update} queueLabel={queueLabel} />} queueLabel={queueLabel} />
  </div>;
}

// Both routes keep the same case mounted after its decision until the user moves on.
function ReviewPanels({ selectionKey, data, selectedId, returnTo, filters, onUpdate, loading, error, retry, returnState, filterPanel, queueLabel }: {
  selectionKey: string; data?: ReviewPage; selectedId?: number; returnTo: string; filters: Record<string, string>; onUpdate: UpdateFilters;
  loading: boolean; error: unknown; retry: () => void; returnState: { scrollY?: number; focusId?: number } | null;
  filterPanel: ReactNode; queueLabel: (label: string) => string;
}) {
  const { t } = useLanguage();
  const [selection, setSelection] = useState({ key: selectionKey, id: data?.cases?.[0]?.id });
  const firstId = data?.cases?.[0]?.id;
  if (selection.key !== selectionKey || (selection.id === undefined && firstId !== undefined)) {
    setSelection({ key: selectionKey, id: firstId });
  }
  const id = selectedId ?? (selection.key === selectionKey ? selection.id : firstId);
  const tabs = QUEUES.filter(([value], index) => index < 2 || filters.queue === value)
    .map(([value, label]) => ({ value, label: queueLabel(label), count: data?.queueCounts?.[value] }));
  const hasFilters = ['locationId', 'areaId', 'date', 'q', 'reasonCode'].some(key => !!filters[key]) || (filters.period && filters.period !== 'all');
  const clear = () => onUpdate(Object.fromEntries(FILTERS.filter(key => key !== 'queue').map(key => [key, ''])));
  return <div className="wx-reviews-grid">
    <section className="wx-review-queue" aria-label={t('Review queue')}>
      <WorkspaceTabs label="Review queues" value={filters.queue} tabs={tabs} onChange={queue => onUpdate({ queue })}>
        {tabs.map(tab => <WorkspaceTabPanel key={tab.value} value={tab.value}>
          <div className="wx-review-search">
            <FindField label="Find a review" placeholder="Search task, staff or site…" value={filters.q ?? ''} onChange={q => onUpdate({ q })} />
            {filterPanel}
          </div>
          <OperationsState loading={loading} error={error} retry={retry} skeleton="panel" />
          {data && <>
            <div className="wx-review-meta"><span>{t('{count} reviews', { count: data.total })}</span><span>{t('Priority, then oldest first')}</span></div>
            <div className="wx-review-records">
              {data.cases?.map(record => record.state === 'RESOLVED'
                ? <ReviewedRecord key={record.id} record={record} selected={id === record.id} returnTo={returnTo} />
                : <QueueRecord key={record.id} record={record} selected={id === record.id} returnTo={returnTo} />)}
              {!data.cases?.length && <EmptyState icon={<CheckCircle2 />}
                title={hasFilters ? 'No matching reviews' : filters.queue === 'needs-me' ? 'Nothing is waiting for you' : 'No reviews yet'}
                message={hasFilters ? 'Try another filter or search.' : filters.queue === 'needs-me' ? 'Every photo review has a decision. New ones appear here automatically.' : 'Try another filter or search.'}
                action={<div className="wx-review-empty-actions">
                  {hasFilters && <button type="button" className="wx-review-button" onClick={clear}>{t('Clear filters')}</button>}
                  {filters.queue !== 'resolved' && <button type="button" className="wx-review-button wx-review-button--primary" onClick={() => onUpdate({ queue: 'resolved' })}>{t('See reviewed')}</button>}
                </div>} />}
            </div>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} totalPages={data.totalPages}
              onPage={value => onUpdate({ page: String(value) })} onSize={value => onUpdate({ pageSize: String(value) })} />
          </>}
        </WorkspaceTabPanel>)}
      </WorkspaceTabs>
    </section>
    <div className="wx-review-case">
      {id ? <ReviewDetail key={id} id={id} backTo={returnTo} returnState={returnState} />
        : <EmptyState icon={<Camera />} title="Select a review" message="Choose a task from the queue to inspect its evidence and record a decision." />}
    </div>
  </div>;
}

type QueueRecordProps = { record: VerificationException; selected: boolean; returnTo: string; outcome?: ReactNode; recordedAt?: string; retry?: ReactNode };
function QueueRecord({ record, selected, returnTo, outcome, recordedAt, retry }: QueueRecordProps) {
  const { t, language } = useLanguage();
  const reason = record.displayReasonCode ?? record.issues.find(issue => issue.state !== 'RESOLVED')?.reasonCode ?? (record.kind === 'SETUP' ? 'SETUP_REQUIRED' : 'REVIEW_REQUIRED');
  const closed = record.state === 'RESOLVED';
  const needsManager = ['OPEN', 'MANAGER_REVIEW'].includes(record.state);
  const time = recordedAt ?? record.updatedAt;
  return <article className="wx-review-record">
    <Link className="wx-review-record-link" data-review-id={record.id} aria-current={selected ? 'true' : undefined}
      to={`/exceptions/${record.id}?returnTo=${encodeURIComponent(returnTo)}`}
      state={{ returnTo, focusId: record.id, scrollY: window.scrollY }} preventScrollReset>
      <div className="wx-review-record-top">
        <StatusPill tone={closed ? 'ok' : needsManager ? 'attention' : 'neutral'}>{closed ? 'Review handled' : plainReason(reason)}</StatusPill>
        <time dateTime={time}><bdi>{localTime(time, record.location?.timezone ?? 'Asia/Karachi', language, true)}</bdi></time>
      </div>
      <h2><bdi>{record.area?.name ?? record.task?.areaNameSnapshot ?? record.task?.title ?? t('Room setup')}</bdi></h2>
      <p className="wx-review-record-context"><bdi>{record.location?.name}</bdi>
        <span aria-hidden="true"> · </span><bdi>{record.kind === 'SETUP' ? t('Room setup') : record.task?.staff?.name ?? t('Unassigned')}</bdi></p>
      {outcome && <p className="wx-review-outcome">{outcome}</p>}
      <div className="wx-review-lifecycle">
        <span>{t(record.kind === 'SETUP' ? 'No task generated' : !record.task ? 'Task submission information unavailable' : record.task.staffSubmittedAt ? 'Task submitted' : 'Task not submitted')}</span>
        <span>{t(closed ? 'Review closed' : 'Review pending')}</span>
      </div>
    </Link>
    {retry}
  </article>;
}

// The list DTO has no closure decision. Reuse the actor-scoped detail cache for
// visible closed rows only; this neither marks them read nor requests photos.
function ReviewedRecord(props: QueueRecordProps) {
  const { t } = useLanguage();
  const query = useException(props.record.id);
  const closure = !query.isError && query.data?.state === 'RESOLVED'
    ? query.data.decisions.find(decision => ['RESOLVE_REVIEW', 'RECORD_PERFORMANCE_ISSUE'].includes(decision.action)) : undefined;
  const outcome = query.isPending ? t('Loading review…') : t(closure
    ? closure.action === 'RECORD_PERFORMANCE_ISSUE' ? 'Staff performance issue recorded' : 'Resolution recorded'
    : 'Review closed; decision details unavailable');
  return <QueueRecord {...props} recordedAt={closure?.createdAt} outcome={outcome}
    retry={query.isError && <button type="button" className="wx-review-button wx-review-outcome-retry" onClick={() => void query.refetch()}>{t('Retry')}</button>} />;
}

function ReviewFilters({ open, onOpenChange, filters, locations, areas, areasLoading, areasError, retryAreas, onUpdate, queueLabel }: {
  open: boolean; onOpenChange: (open: boolean) => void; filters: Record<string, string>;
  locations: ReviewPage['locations']; areas: Array<{ id: number; name: string }>; areasLoading: boolean; areasError: unknown;
  retryAreas: () => void; onUpdate: UpdateFilters; queueLabel: (label: string) => string;
}) {
  const { t } = useLanguage();
  const panelId = useId();
  return <>
    <button type="button" className="wx-review-button wx-review-filter-toggle" aria-label={t('Review filters')}
      aria-controls={panelId} aria-expanded={open} onClick={() => onOpenChange(!open)}>
      <SlidersHorizontal aria-hidden="true" />{(filters.areaId || filters.reasonCode || ['staff', 'service'].includes(filters.queue)) && <span className="wx-review-filter-dot" />}
    </button>
    {open && <section className="wx-review-filter-panel" id={panelId} aria-label={t('Review filters')}>
      <div className="wx-review-filter-field"><span>{t('Review reason')}</span>
        <SelectMenu label="Review reason" value={filters.reasonCode ?? ''} onChange={reasonCode => onUpdate({ reasonCode })}
          options={[{ value: '', label: 'All reasons' }, ...['SERVICE_FAILURE', 'MISSING_EVIDENCE', 'CANNOT_ASSESS', 'PRIVACY_HOLD', 'CLEANING_REQUIRED', 'WRONG_ITEM'].map(value => ({ value, label: plainReason(value) }))]} />
      </div>
      <div className="wx-review-filter-field"><span>{t('Location')}</span>
        <SelectMenu label="Location" value={filters.locationId ?? ''} onChange={locationId => onUpdate({ locationId })}
          options={[{ value: '', label: 'All locations' }, ...locations.map(site => ({ value: String(site.id), label: site.name, translateLabel: false }))]} />
      </div>
      <div className="wx-review-filter-field"><span>{t('Area')}</span>
        <SelectMenu label="Area" value={filters.areaId ?? ''} disabled={!filters.locationId || areasLoading || !!areasError}
          onChange={areaId => onUpdate({ areaId })} options={[{ value: '', label: 'All areas' }, ...areas.map(area => ({ value: String(area.id), label: area.name, translateLabel: false }))]} />
        {areasLoading && <p role="status">{t('Loading…')}</p>}
        {areasError ? <OperationsState error={areasError} retry={retryAreas} /> : null}
      </div>
      <div className="wx-review-filter-field"><span>{t('Period')}</span>
        <SelectMenu label="Period" value={filters.period ?? 'all'} onChange={period => onUpdate({ period })}
          options={PERIODS.map(([value, label]) => ({ value, label }))} />
      </div>
      {filters.period === 'date' && <DateMenu label="Local date" value={filters.date === 'today' ? '' : filters.date ?? ''}
        quickOptions={[]} onChange={date => onUpdate({ date })} />}
      <div className="wx-review-filter-field"><span>{t('Review queue')}</span>
        <SelectMenu label="Review queue" value={filters.queue} onChange={queue => onUpdate({ queue })}
          options={QUEUES.map(([value, label]) => ({ value, label: queueLabel(label) }))} />
      </div>
      <button type="button" className="wx-review-button" onClick={() => onUpdate(Object.fromEntries(FILTERS.filter(key => key !== 'queue').map(key => [key, ''])))}>{t('Clear filters')}</button>
    </section>}
  </>;
}
