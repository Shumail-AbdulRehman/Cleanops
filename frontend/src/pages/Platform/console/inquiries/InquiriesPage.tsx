import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { ChipGroup } from '@/components/workspace/ChipGroup';
import { useLanguage } from '@/i18n/context';
import { operatorQueryScope } from '../../operatorSession';
import {
  getInquiries, getInquiry, saveInquiry,
  type Handling, type HandlingStatus, type Inquiry, type InquiryDetail,
} from '../../serviceApi';
import './inquiries.css';

const statuses = ['NEW', 'IN_PROGRESS', 'CLOSED'] as const;
const statusLabels = { NEW: 'New', IN_PROGRESS: 'In progress', CLOSED: 'Closed' };
const listKey = [...operatorQueryScope, 'console-inquiries'] as const;
const pageSize = 25;
const mobileLayout = '(max-width: 860px)';

function detailOptions(id: string) {
  return queryOptions({
    queryKey: [...listKey, id],
    queryFn: ({ signal }) => getInquiry(id, signal),
    staleTime: 30_000,
  });
}

async function loadInquiries(signal: AbortSignal) {
  const inquiries: Inquiry[] = [];
  let after: string | undefined;
  do {
    const page = await getInquiries({ after }, signal);
    inquiries.push(...page.items);
    after = page.nextCursor ?? undefined;
  } while (after);
  return inquiries;
}

function InquiryStatus({ status }: { status: HandlingStatus }) {
  const { t } = useLanguage();
  return <span className="px-inquiries-status" data-status={status}>{t(statusLabels[status])}</span>;
}

function InquiryDate({ date }: { date: string }) {
  const { language, t } = useLanguage();
  if (!date || !Number.isFinite(Date.parse(date))) return t('Not available');
  const label = new Intl.DateTimeFormat(language === 'ur' ? 'ur-PK' : 'en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi',
  }).format(new Date(date));
  return <time dateTime={date}>{label}</time>;
}

function InquiryRow({ inquiry, selected, onSelect }: {
  inquiry: Inquiry;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useLanguage();
  const detail = useQuery(detailOptions(inquiry.id));
  const firstLine = detail.data?.requirements?.trim().split(/\r?\n/, 1)[0];
  return (
    <li>
      <button type="button" className="px-inquiries-row" aria-pressed={selected} onClick={onSelect}>
        <span className="px-inquiries-row-heading">
          <strong dir="auto">{inquiry.company ?? t('Not available')}</strong>
          <span><InquiryDate date={inquiry.createdAt} /></span>
        </span>
        <span className="px-inquiries-row-meta">
          <InquiryStatus status={inquiry.handling.status} />
          <span>
            {inquiry.requestedLocations == null ? t('Not available') : t('{count} locations', { count: inquiry.requestedLocations })}
            {' · '}
            {inquiry.requestedStaff == null ? t('Not available') : t('{count} staff', { count: inquiry.requestedStaff })}
          </span>
        </span>
        <span className="px-inquiries-preview" dir="auto">
          {detail.isPending ? t('Loading request…') : detail.isError ? t('Not available') : firstLine || t('Not available')}
        </span>
      </button>
    </li>
  );
}

type SaveDraft = Omit<Parameters<typeof saveInquiry>[1], 'ownership'>;

function HandlingForm({ inquiry, reload, reloading, reloadFailed }: {
  inquiry: InquiryDetail;
  reload: () => Promise<InquiryDetail | undefined>;
  reloading: boolean;
  reloadFailed: boolean;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const noteId = useId();
  const [draft, setDraft] = useState<SaveDraft | null>(null);
  const current = draft ?? { status: inquiry.handling.status, expectedVersion: inquiry.handling.version, reason: '' };
  const refreshListRow = (handling: Handling) => {
    queryClient.setQueryData<Inquiry[]>(listKey, rows => rows?.map(row =>
      row.id === inquiry.id ? { ...row, handling } : row,
    ));
  };
  const mutation = useMutation({
    mutationFn: (body: SaveDraft) => saveInquiry(inquiry.id, { ...body, ownership: 'SELF' }),
    onSuccess: async ({ handling }) => {
      const { queryKey } = detailOptions(inquiry.id);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: listKey, exact: true }),
        queryClient.cancelQueries({ queryKey, exact: true }),
      ]);
      queryClient.setQueryData<InquiryDetail>(queryKey, detail => detail && { ...detail, handling });
      refreshListRow(handling);
      setDraft(null);
    },
  });
  const conflict = !!mutation.error && 'status' in mutation.error && mutation.error.status === 409;
  const disabled = mutation.isPending || reloading;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = current.reason.trim();
    if (!reason || disabled || conflict) return;
    mutation.mutate({ ...current, reason });
  };

  const reloadInquiry = async () => {
    const refreshed = await reload();
    if (!refreshed) return;
    const { status, version } = refreshed.handling;
    refreshListRow(refreshed.handling);
    setDraft({ status, expectedVersion: version, reason: current.reason });
    mutation.reset();
  };

  return (
    <form className="px-inquiries-form" onSubmit={submit}>
      <fieldset disabled={disabled || conflict}>
        <legend>{t('Status')}</legend>
        <div className="px-inquiries-status-options">
          {statuses.map(status => (
            <label key={status}>
              <input type="radio" name={`${noteId}-status`} value={status} checked={current.status === status}
                onChange={() => setDraft({ ...current, status })} />
              {t(statusLabels[status])}
            </label>
          ))}
        </div>
      </fieldset>
      <label htmlFor={noteId}>{t('Note')}</label>
      <textarea id={noteId} required aria-describedby={`${noteId}-hint`} value={current.reason} disabled={disabled}
        onChange={event => setDraft({ ...current, reason: event.target.value })} />
      <p className="px-inquiries-secondary" id={`${noteId}-hint`}>{t('Required. Kept with the status change.')}</p>
      <div className="px-inquiries-actions">
        <button type="submit" className="px-inquiries-button" disabled={disabled || conflict || !current.reason.trim()}>
          {mutation.isPending ? t('Saving…') : t('Save status')}
        </button>
        {conflict && (
          <button type="button" className="px-inquiries-button px-inquiries-button-secondary"
            disabled={disabled} onClick={() => void reloadInquiry()}>{t('Reload inquiry')}</button>
        )}
      </div>
      {conflict && <p role="alert">
        {t('This inquiry changed. Reload it before saving again.')}
        {reloadFailed && <> {t('Could not reload the inquiry. Try again.')}</>}
      </p>}
      {mutation.isError && !conflict && <p role="alert">{t('Could not save the status. Try again.')}</p>}
      {mutation.isSuccess && (
        <p role="status">{mutation.data.changed ? t('Inquiry updated.') : t('The inquiry already has this status and owner.')}</p>
      )}
    </form>
  );
}

function InquiryDetails({ id }: { id: string }) {
  const { t } = useLanguage();
  const query = useQuery(detailOptions(id));
  if (query.isPending) return <p role="status">{t('Loading inquiry…')}</p>;
  const status = query.error && 'status' in query.error ? query.error.status : undefined;
  if (!query.data || (typeof status === 'number' && status >= 400 && status < 500)) return (
    <div className="px-inquiries-state">
      <p role="alert">{t('Could not load the inquiry.')}</p>
      <button type="button" className="px-inquiries-button px-inquiries-button-secondary"
        onClick={() => void query.refetch()}>{t('Retry')}</button>
    </div>
  );
  const inquiry = query.data;
  const { requestedLocations, requestedStaff } = inquiry;
  const aboveEnterprise = requestedLocations > 20 || requestedStaff > 200;
  const fit = aboveEnterprise ? t('Above Enterprise limits')
    : requestedLocations == null || requestedStaff == null ? t('Not available') : t('Enterprise');
  return (
    <>
      <header className="px-inquiries-detail-heading">
        <div>
          <h2 dir="auto">{inquiry.company ?? t('Not available')}</h2>
          <p className="px-inquiries-secondary">
            <bdi>{inquiry.contactName ?? t('Not available')}</bdi> · {t('Received')} <InquiryDate date={inquiry.createdAt} />
          </p>
        </div>
        <InquiryStatus status={inquiry.handling.status} />
      </header>
      <dl className="px-inquiries-facts">
        <div><dt>{t('Locations')}</dt><dd>{requestedLocations ?? t('Not available')}</dd></div>
        <div><dt>{t('Staff')}</dt><dd>{requestedStaff ?? t('Not available')}</dd></div>
        <div><dt>{t('Plan that fits')}</dt><dd>{fit}</dd></div>
      </dl>
      <p className="px-inquiries-request" dir="auto">{inquiry.requirements ?? t('Not available')}</p>
      <div className="px-inquiries-actions px-inquiries-contact">
        {inquiry.contactEmail && (
          <a className="px-inquiries-button" href={`mailto:${encodeURIComponent(inquiry.contactEmail).replace('%40', '@')}`}>
            <Mail size={17} aria-hidden="true" />{t('Email')}
          </a>
        )}
        <bdi className="px-inquiries-secondary">{inquiry.contactEmail ?? t('Not available')}</bdi>
      </div>
      <HandlingForm key={id} inquiry={inquiry} reloading={query.isFetching} reloadFailed={query.isRefetchError}
        reload={async () => {
          const result = await query.refetch();
          return result.isSuccess ? result.data : undefined;
        }} />
    </>
  );
}

export function InquiriesPage() {
  const { t } = useLanguage();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('ALL');
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const detailRef = useRef<HTMLElement>(null);
  const inquiries = useQuery({ queryKey: listKey, queryFn: ({ signal }) => loadInquiries(signal) });
  const rows = inquiries.data ?? [];
  const matching = status === 'ALL' ? rows : rows.filter(row => row.handling.status === status);
  const selected = params.get('inquiry');
  const first = rows[0]?.id;

  useEffect(() => {
    if (selected || !first) return;
    const next = new URLSearchParams(params);
    next.set('inquiry', first);
    setParams(next, { replace: true });
  }, [first, params, selected, setParams]);

  const select = (id: string) => {
    if (selected !== id) {
      const next = new URLSearchParams(params);
      next.set('inquiry', id);
      setParams(next);
    }
    if (window.matchMedia(mobileLayout).matches) {
      detailRef.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView({ block: 'start' });
    }
  };

  return (
    <div className="px-inquiries">
      <h1>{t('Inquiries')}</h1>
      {inquiries.isPending ? (
        <div className="px-panel" role="status">{t('Loading inquiries…')}</div>
      ) : inquiries.isError ? (
        <div className="px-panel px-inquiries-state">
          <p role="alert">{t('Could not load inquiries.')}</p>
          <button type="button" className="px-inquiries-button px-inquiries-button-secondary"
            onClick={() => void inquiries.refetch()}>{t('Retry')}</button>
        </div>
      ) : rows.length === 0 ? (
        <p className="px-panel">{t('No inquiries yet.')}</p>
      ) : (
        <>
          <ChipGroup label="Inquiry status" value={status}
            options={[
              { value: 'ALL', label: 'All', count: rows.length },
              ...statuses.map(value => ({
                value, label: statusLabels[value], count: rows.filter(row => row.handling.status === value).length,
              })),
            ]}
            onChange={value => { setStatus(value); setVisibleCount(pageSize); }} />
          <div className="px-inquiries-layout">
            <div className="px-inquiries-list">
              {matching.length === 0 ? (
                <p className="px-inquiries-list-empty">{t('No inquiries with this status.')}</p>
              ) : (
                <ul aria-label={t('Inquiries')}>
                  {matching.slice(0, visibleCount).map(row => (
                    <InquiryRow key={row.id} inquiry={row} selected={row.id === selected} onSelect={() => select(row.id)} />
                  ))}
                </ul>
              )}
              {matching.length > visibleCount && (
                <div className="px-inquiries-more">
                  <button type="button" className="px-inquiries-button px-inquiries-button-secondary"
                    onClick={() => setVisibleCount(count => count + pageSize)}>{t('Show more inquiries')}</button>
                </div>
              )}
            </div>
            <section className="px-panel px-inquiries-detail" aria-label={t('Inquiry details')} tabIndex={-1} ref={detailRef}>
              {selected && <InquiryDetails key={selected} id={selected} />}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

export default InquiriesPage;
