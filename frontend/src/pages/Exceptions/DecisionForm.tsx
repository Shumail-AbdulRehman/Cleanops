import { useId, useRef, useState } from 'react';
import { Link, useBeforeUnload, useBlocker } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useOnline } from '@/hooks/useOnline';
import { useLanguage } from '@/i18n/context';
import { Button } from '@/components/ui/button';
import { closeException } from './api';
import type { ExceptionDetail, ReviewClosureAction, PerformanceCategory } from './types';
import { performanceCategoryLabels } from './performancePresentation';
import { localTime } from '../Manager/operations';
import './decision-v6.css';

type Field = 'staff' | 'category' | 'note';

export default function DecisionForm({ detail, onDone, nextReviewHref, unavailable = false }: {
  detail: ExceptionDetail;
  onDone: (message?: string) => Promise<void>;
  nextReviewHref?: string;
  unavailable?: boolean;
}) {
  const { t, language } = useLanguage();
  const online = useOnline();
  const id = useId();
  const actions = detail.closureActions ?? [];
  const staffOptions = detail.performanceStaffOptions ?? [];
  const [action, setAction] = useState<ReviewClosureAction | ''>(actions.includes('RESOLVE_REVIEW') ? 'RESOLVE_REVIEW' : '');
  const [note, setNote] = useState('');
  const [category, setCategory] = useState<PerformanceCategory | ''>('');
  const [staffId, setStaffId] = useState(staffOptions.length === 1 ? String(staffOptions[0].id) : '');
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const stale = conflictVersion !== null && conflictVersion === detail.rowVersion;
  const pending = useRef<{ body: string; requestId: string } | null>(null);
  const saving = useRef(false);
  const staffField = useRef<HTMLSelectElement>(null);
  const categoryField = useRef<HTMLSelectElement>(null);
  const noteField = useRef<HTMLTextAreaElement>(null);
  const performance = action === 'RECORD_PERFORMANCE_ISSUE';
  const validStaff = staffOptions.some(staff => String(staff.id) === staffId);
  const validCategory = Object.hasOwn(performanceCategoryLabels, category);
  const validNote = !!note.trim();
  const invalid = (field: Field) => (submitted || touched[field]) &&
    (field === 'note' ? !validNote : performance && (field === 'staff' ? !validStaff : !validCategory));
  const touch = (field: Field) => setTouched(previous => ({ ...previous, [field]: true }));

  const mutation = useMutation({
    mutationFn: async () => {
      if (unavailable || !online || !action || !actions.includes(action)) throw new Error(t('Refresh this review before choosing an action.'));
      const input = {
        expectedVersion: detail.rowVersion, action, note: note.trim(),
        ...(action === 'RECORD_PERFORMANCE_ISSUE' ? { staffId: Number(staffId), category: category as PerformanceCategory } : {}),
      };
      const body = JSON.stringify(input);
      if (pending.current?.body !== body) pending.current = { body, requestId: crypto.randomUUID() };
      return closeException(detail.id, { ...input, requestId: pending.current.requestId });
    },
    onError: (error: { response?: { status?: number } }) => {
      if (error.response?.status === 409) setConflictVersion(detail.rowVersion);
    },
    onSettled: () => { saving.current = false; },
    onSuccess: async () => {
      setNote('');
      await onDone(action === 'RECORD_PERFORMANCE_ISSUE' ? 'Staff performance issue recorded. This task review is now closed.' : 'Review resolved. This task is no longer in the active exception queue.');
      setAction('');
      setCategory('');
      setSubmitted(false);
      setTouched({});
    },
  });
  const blocker = useBlocker(({ currentLocation, nextLocation }) => !!note && !mutation.isPending && reviewNavigationKey(currentLocation) !== reviewNavigationKey(nextLocation));
  useBeforeUnload(event => { if (note) event.preventDefault(); });

  if (detail.state === 'RESOLVED') {
    const closure = detail.decisions.find(decision => ['RESOLVE_REVIEW', 'RECORD_PERFORMANCE_ISSUE'].includes(decision.action));
    const timezone = detail.location?.timezone ?? 'Asia/Karachi';
    return <section className="wx-decision wx-decision--saved" aria-labelledby={`${id}-saved-title`}>
      <div className="wx-decision-record">
        <h3 id={`${id}-saved-title`}>{t('Decision recorded')}</h3>
        {closure ? <>
          <p role="status" className="wx-decision-result">{t(closure.action === 'RECORD_PERFORMANCE_ISSUE' ? 'Staff performance issue recorded' : 'Resolution recorded')}</p>
          <dl className="wx-decision-facts">
            <div><dt>{t('Manager reviewed')}</dt><dd><bdi>{closure.actorManager?.name ?? t('Manager name unavailable')}</bdi></dd></div>
            <div><dt>{t('Recorded at')}</dt><dd><time dateTime={closure.createdAt}><bdi>{localTime(closure.createdAt, timezone, language, true)}</bdi> (<bdi>{timezone}</bdi>)</time></dd></div>
          </dl>
          <div className="wx-decision-saved-note"><h4>{t('Saved note')}</h4><p><bdi>{closure.note ?? t('Decision note unavailable')}</bdi></p></div>
        </> : <p role="status">{t('Review closed; decision details unavailable')}</p>}
      </div>
      <p className="wx-decision-hint">{t('This review is closed. Task verification remains as recorded.')}</p>
      {nextReviewHref && <div className="wx-decision-footer"><Button asChild className="wx-decision-button wx-decision-button--primary"><Link to={nextReviewHref}>{t('Next pending review')}<ArrowRight className="wx-decision-arrow" size={16} aria-hidden="true" /></Link></Button></div>}
    </section>;
  }
  if (detail.kind === 'SETUP') return <p className="wx-decision-notice" role="status">{t('Complete the room setup before reviewing task photos. No staff decision is available for this setup record.')}</p>;
  if (!actions.length) return <div className="wx-decision-notice" role="status"><p>{t('Review decisions could not be loaded. Refresh the page to continue.')}</p><Button type="button" variant="outline" className="wx-decision-button" onClick={() => void onDone()}>{t('Refresh review')}</Button></div>;

  const errorStatus = (mutation.error as { response?: { status?: number } })?.response?.status;
  const blocked = unavailable || stale || !online || mutation.isPending || !action || !actions.includes(action);
  const choose = (value: ReviewClosureAction) => {
    setAction(value);
    setSubmitted(false);
    setTouched({});
    mutation.reset();
  };
  return <section className="wx-decision" aria-labelledby={`${id}-title`}>
    {blocker.state === 'blocked' && <div role="alert" className="wx-decision-notice">
      <p>{t('You have an unsaved note. Stay to save it or leave this review.')}</p>
      <div className="wx-decision-footer"><Button type="button" className="wx-decision-button wx-decision-button--primary" onClick={() => blocker.reset()}>{t('Stay here')}</Button><Button type="button" variant="outline" className="wx-decision-button" onClick={() => blocker.proceed()}>{t('Leave review')}</Button></div>
    </div>}
    <h3 id={`${id}-title`}>{t('Your decision')}</h3>
    <p className="wx-decision-hint" id={`${id}-hint`}>{t('Choose one outcome for the whole task review. It stays here until you save a decision.')}</p>
    {unavailable && <div className="wx-decision-notice" role="alert"><p>{t('Review details could not refresh. Your note is kept. Refresh before saving a decision.')}</p><Button type="button" variant="outline" className="wx-decision-button" onClick={() => void onDone()}>{t('Refresh review')}</Button></div>}
    {!online && <p className="wx-decision-notice" role="status">{t('You’re offline')}. {t('Reconnect, then refresh before making changes.')}</p>}
    <fieldset className="wx-decision-outcomes" aria-labelledby={`${id}-title`} aria-describedby={`${id}-hint`} disabled={mutation.isPending}>
      {(['RESOLVE_REVIEW', 'RECORD_PERFORMANCE_ISSUE'] as const).filter(value => actions.includes(value)).map(value => {
        const label = value === 'RESOLVE_REVIEW' ? 'Resolve review' : 'Record staff performance issue';
        const description = value === 'RESOLVE_REVIEW' ? 'Close this review without recording a staff performance issue.' : 'Save a staff KPI issue and close this review.';
        return <label key={value} className="wx-decision-outcome">
          <input type="radio" name={`${id}-outcome`} value={value} checked={action === value} onChange={() => choose(value)} aria-labelledby={`${id}-${value}-label`} aria-describedby={`${id}-${value}-description`} />
          <span><strong id={`${id}-${value}-label`}>{t(label)}</strong><small id={`${id}-${value}-description`}>{t(description)}</small></span>
        </label>;
      })}
    </fieldset>
    {!actions.includes('RECORD_PERFORMANCE_ISSUE') && <p className="wx-decision-hint">{t(detail.performanceIssueRecorded ? 'A performance issue has already been recorded for this task.' : 'A performance issue needs a staff member assigned to this task.')}</p>}
    {action && <form className="wx-decision-form" noValidate aria-busy={mutation.isPending} onSubmit={event => {
      event.preventDefault();
      if (blocked || saving.current) return;
      setSubmitted(true);
      if (performance && !validStaff) { staffField.current?.focus(); return; }
      if (performance && !validCategory) { categoryField.current?.focus(); return; }
      if (!validNote) { noteField.current?.focus(); return; }
      saving.current = true;
      mutation.mutate();
    }}>
      {performance && <>
        <div className="wx-decision-fields">
          <div className="wx-decision-field">
            <label htmlFor={`${id}-staff`}>{t('Staff member')}</label>
            <select id={`${id}-staff`} ref={staffField} required disabled={mutation.isPending} value={staffId} onChange={event => setStaffId(event.target.value)} onBlur={() => touch('staff')} aria-invalid={!!invalid('staff')} aria-describedby={invalid('staff') ? `${id}-staff-error` : undefined}>
              <option value="">{t('Choose responsible staff member')}</option>
              {staffOptions.map(staff => <option key={staff.id} value={staff.id}>{staff.name}</option>)}
            </select>
            {invalid('staff') && <p id={`${id}-staff-error`} role="alert" className="wx-decision-error">{t('Choose responsible staff member')}</p>}
          </div>
          <div className="wx-decision-field">
            <label htmlFor={`${id}-category`}>{t('Performance category')}</label>
            <select id={`${id}-category`} ref={categoryField} required disabled={mutation.isPending} value={category} onChange={event => setCategory(event.target.value as PerformanceCategory)} onBlur={() => touch('category')} aria-invalid={!!invalid('category')} aria-describedby={invalid('category') ? `${id}-category-error` : undefined}>
              <option value="">{t('Choose a category')}</option>
              {Object.entries(performanceCategoryLabels).map(([key, label]) => <option value={key} key={key}>{t(key === 'MISSING_PHOTOS' ? 'Missing photos' : key === 'OTHER' ? 'Other' : label)}</option>)}
            </select>
            {invalid('category') && <p id={`${id}-category-error`} role="alert" className="wx-decision-error">{t('Choose a performance category.')}</p>}
          </div>
        </div>
        <p className="wx-decision-hint">{t('Record a performance issue only after checking the circumstances. A photo-check failure does not automatically count against staff.')}</p>
      </>}
      <div className="wx-decision-field">
        <label htmlFor={`${id}-note`}>{t(performance ? 'Performance note' : 'Resolution note')}</label>
        <textarea id={`${id}-note`} ref={noteField} required maxLength={1000} rows={3} disabled={mutation.isPending} value={note} onChange={event => setNote(event.target.value)} onBlur={() => touch('note')} placeholder={t('What did you decide, and why?')} aria-invalid={!!invalid('note')} aria-describedby={invalid('note') ? `${id}-note-error` : undefined} />
        {invalid('note') && <p id={`${id}-note-error`} role="alert" className="wx-decision-error">{t('Add a note before saving.')}</p>}
      </div>
      <p className="wx-decision-hint">{t('This closes the review. Existing photos and task completion records stay as recorded.')}</p>
      {(stale || (mutation.isError && errorStatus !== 409)) && <p role="alert" className="wx-decision-error">{stale ? t('This review changed. Refresh before saving. Your note is kept.') : [401, 403].includes(errorStatus ?? 0) ? t('You do not have access to save a decision for this review. Your note is kept.') : t('Could not save your decision. Check your connection and try again.')}</p>}
      <div className="wx-decision-footer">
        {stale && !unavailable && <Button type="button" variant="outline" className="wx-decision-button" onClick={() => void onDone()}>{t('Refresh review')}</Button>}
        <Button type="button" variant="ghost" className="wx-decision-button wx-decision-button--ghost" disabled={mutation.isPending} onClick={() => { setAction(''); setSubmitted(false); setTouched({}); mutation.reset(); }}>{t('Cancel')}</Button>
        <Button type="submit" className="wx-decision-button wx-decision-button--primary" disabled={blocked}>{t(mutation.isPending ? 'Saving decision…' : performance ? 'Record issue and close review' : 'Confirm resolution')}</Button>
      </div>
    </form>}
  </section>;
}

// Inspecting another view of the same review keeps its decision draft. Leaving the
// review or changing queue filters still asks the reviewer to keep or discard it.
function reviewNavigationKey(location: { pathname: string; search: string }) {
  const params = new URLSearchParams(location.search);
  params.delete('requirementId');
  params.delete('issueId');
  params.sort();
  return location.pathname + '?' + params;
}
