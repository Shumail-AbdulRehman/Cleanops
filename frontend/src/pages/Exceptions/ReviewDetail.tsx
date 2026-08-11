import LaunchReviewContext from './LaunchReviewContext';
import ReviewSummary from './ReviewSummary';
import {reviewDiagnosis, issueDiagnosis, reviewViewLabel, type DiagnosisRow} from './reviewDiagnosis';
import StatusPill, { type StatusPillTone } from '@/components/workspace/StatusPill';
import { useSelector } from "react-redux";
import type { RootState } from "@/store/store";
import { useEffect, useRef, useState } from "react";
import {
  Link,
  useSearchParams,
  useLocation,
} from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Camera,
  MapPin,
  UserRound,
  Clock3,
} from "lucide-react";
import { useLanguage } from "@/i18n/context";
import { useOnline } from "@/hooks/useOnline";
import { Button } from "@/components/ui/button";
import { client } from "@/api/client";
import { invalidateWorkspace } from "@/lib/invalidateWorkspace";
import ProtectedEvidence from "../Verification/ProtectedEvidence";
import {
  exceptionStateLabel,
  plainReason,
} from "../Verification/presentation";
import { localTime } from "../Manager/operations";
import OperationsState from "../Manager/OperationsState";
import DecisionForm from "./DecisionForm";
import { useException } from "./queries";
import { decideException, readException } from "./api";
import { reviewActionLabels } from './reviewPresentation';
import type {
  VerificationIssue,
} from "./types";
import type { EvidenceAttempt } from '../Verification/types';
import './review-detail-v6.css';

function evidenceTone(category?: DiagnosisRow['category']): StatusPillTone {
  return category === 'checked' ? 'ok' : category === 'processing' ? 'progress'
    : category === 'missing' ? 'bad' : category ? 'attention' : 'neutral';
}

function EvidencePhoto({ photo, name, missing, description, thumbnail = false }: {
  photo?: EvidenceAttempt | null; name: string; missing: boolean;
  description: string; thumbnail?: boolean;
}) {
  const { t } = useLanguage();
  if (photo?.mediaAssetId && photo.privacyState !== 'DISCARDED') return <ProtectedEvidence
    key={photo.mediaAssetId} assetId={photo.mediaAssetId} privacyState={photo.privacyState}
    allowRestrictedReview variant={thumbnail ? 'thumbnail' : 'workspace'} alt={name}
  />;
  return <div className="wx-case-photo-missing">
    <Camera size={26} aria-hidden="true" />
    <strong>{t(photo?.privacyState === 'DISCARDED' ? 'Rejected photo was not kept'
      : photo ? 'Photo is unavailable to view' : missing ? 'This required photo is missing' : 'No photo linked to this issue')}</strong>
    {!thumbnail && <p>{t(photo?.privacyState === 'DISCARDED'
      ? 'The photo was rejected and was not retained for manager review. Its recorded check result is explained in this review.'
      : photo ? 'Use the recorded explanation in this review. A preview is not available for this attempt.' : description)}</p>}
  </div>;
}
function safeReviewReturn(value: string | null) {
  return value && /^\/(exceptions|dashboard|today-status|staff\/\d+|locations\/\d+)(\?|$)/.test(value)
    ? value
    : "/exceptions";
}
export default function ReviewDetail({ id, backTo, returnState }: {
  id:number; backTo:string; returnState?:{scrollY?:number;focusId?:number}|null;
}) {
  const { t, language } = useLanguage();
  const online = useOnline();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const query = useException(id);
  const cache = useQueryClient();
  const detail = query.data;
  const [notice, setNotice] = useState("");
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pendingAcceptance = useRef<{ decision: string; requestId: string } | null>(null);
  const issueId = params.get('issueId');
  const requirementId = params.get('requirementId');
  const focusedRequirement = requirementId ?? detail?.issues.find(row => row.id === Number(issueId))?.requirementId;
  const loaded = !!detail;
  useEffect(() => {
    if (!loaded || (!issueId && !requirementId)) return;
    const target = document.getElementById(focusedRequirement ? `review-view-${encodeURIComponent(focusedRequirement)}` : `review-issue-${issueId}`);
    if (target && root.current?.contains(target)) {
      target.focus({ preventScroll: true });
      target.scrollIntoView?.({ block: 'nearest' });
    }
  }, [id, loaded, issueId, requirementId, focusedRequirement]);
  const returnTo = safeReviewReturn(
    params.get("returnTo") ??
      (location.state as { returnTo?: string } | null)?.returnTo ??
      backTo,
  );
  const actorScope = useSelector(
    (s: RootState) =>
      `${s.auth.user?.companyId}:${s.auth.user?.role}:${s.auth.user?.id}`,
  );
  const listFilters = Object.fromEntries(
    new URLSearchParams(returnTo.split("?")[1] ?? ""),
  );
  const nextFilters = {...listFilters, queue: detail?.state === 'RESOLVED' ? 'needs-me' : listFilters.queue ?? 'needs-me'};
  const nextReturnTo = detail?.state === 'RESOLVED'
    ? '/exceptions?' + new URLSearchParams({...nextFilters,page:'1'}) : returnTo;
  const next = useQuery({
    queryKey: ["review-next", actorScope, id, listFilters, detail?.state],
    queryFn: async ({ signal }) => {
      const result = (await client.get<{data:{nextId:number|null}}>(`/verification-exceptions/${id}/next`, {params:nextFilters,signal})).data.data;
      if(result.nextId || detail?.state !== 'RESOLVED') return result;
      const first = (await client.get<{data:{cases:Array<{id:number}>}}>('/verification-exceptions',{params:{...nextFilters,page:'1',pageSize:'1'},signal})).data.data.cases[0];
      return {nextId:first?.id !== id ? first?.id ?? null : null};
    },
    enabled: id > 0,
  });
  const nextReviewHref = next.data?.nextId ? `/exceptions/${next.data.nextId}?returnTo=${encodeURIComponent(nextReturnTo)}` : undefined;
  useEffect(() => {
    if (detail?.rowVersion === undefined) return;
    void readException(id)
      .then(() => cache.invalidateQueries({ queryKey: ["exception-count"] }))
      .catch(() => {});
  }, [id, detail?.rowVersion, cache]);
  async function done(message?: string) {
    if (message) setNotice(message);
    await invalidateWorkspace(cache);
    try {
      const refreshed = await query.refetch({ throwOnError: true });
      if (message && refreshed.data) {
        const remaining = refreshed.data.issues.filter(
          (i) => i.state !== "RESOLVED",
        );
        const target =
          remaining.find((i) => ["OPEN", "MANAGER_REVIEW"].includes(i.state)) ??
          remaining[0];
        setParams(
          (old) => {
            const n = new URLSearchParams(old);
            n.delete("requirementId");
            if (target) n.set("issueId", String(target.id));
            else n.delete("issueId");
            return n;
          },
          { replace: true },
        );
      }
      await next.refetch();
    } catch {
      if (message)
        setNotice(
          "Decision saved; updated details could not load. Refresh before another decision.",
        );
    }
  }
  const acceptPhoto = useMutation({
    mutationFn: (input: Parameters<typeof decideException>[1]) => decideException(id, input),
    onSuccess: async () => {
      pendingAcceptance.current = null;
      await done('Decision saved. The task status below reflects the server review.');
    },
    onError: async (error: { response?: { status?: number } }) => {
      if (error.response?.status === 409) await done();
    },
  });
  const errorStatus = (query.error as {response?:{status?:number}})?.response?.status;
  const denied = [401,403,404,410].includes(errorStatus ?? 0);
  if (query.isPending || !detail || denied)
    return (
      <div className="wx-review-detail">
        <Link className="wx-case-link" to={returnTo} state={returnState}>
          {t(returnTo.startsWith("/exceptions") ? "Back to reviews" : "Back")}
        </Link>
        {denied ? <div className="wx-case-notice" role="alert">
          <p>{t(errorStatus === 401 ? 'Sign in again to view this review.' : errorStatus === 403 ? 'You do not have access to this review.' : 'Review unavailable. Return to the queue or refresh to check again.')}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>{t('Retry')}</Button>
        </div> : <OperationsState
          loading={query.isPending}
          layout="review-detail"
          error={query.error}
          retry={() => void query.refetch()}
        />}
      </div>
    );
  const requirements = detail.items?.flatMap((item) => item.requirements.map((r) => ({...r,item}))) ?? [];
  const requestedIssue = detail.issues.find((i) => i.id === Number(params.get('issueId')));
  const defaultRequirement = detail.state !== 'RESOLVED' && !params.has('requirementId') && !requestedIssue?.requirementId && !params.has('issueId')
    ? requirements.find(r => ['CLEANING_REQUIRED','RECAPTURE_REQUIRED','REVIEW_REQUIRED'].includes(r.state))
      ?? requirements.find(r => r.mandatory && r.item.mandatory !== false && r.state === 'MISSING') : undefined;
  const selectedRequirement = requirements.find((r) => r.id === params.get('requirementId')) ?? defaultRequirement;
  const linkedIssue = detail.issues.find(i => i.requirementId === selectedRequirement?.id && i.state !== 'RESOLVED');
  const open = detail.issues.filter((i) => i.state !== "RESOLVED");
  const visibleIssues = detail.issues.filter(row => row.state !== 'RESOLVED' || row.id === Number(issueId));
  const chosen =
    detail.issues.find((i) => i.id === Number(params.get("issueId"))) ??
    open[0] ??
    detail.issues[0];
  const requirementIssue: VerificationIssue | undefined = selectedRequirement
    ? linkedIssue ?? {
        id: -1,
        reasonCode: selectedRequirement.currentAttempt?.reviewSummary?.reasonCode ??
          (selectedRequirement.state === 'MISSING' ? 'MISSING_EVIDENCE' : selectedRequirement.state),
        requirementId: selectedRequirement.id,
        requirement: selectedRequirement,
        state: selectedRequirement.state,
        occurrences: 1,
        recommendedAction: selectedRequirement.instructionsSnapshot,
        firstSeenAt: detail.firstRaisedAt,
        lastSeenAt: detail.updatedAt,
        latestAttempt: selectedRequirement.currentAttempt,
        allowedActions: selectedRequirement.allowedActions,
      }
    : undefined;
  const issue = requirementIssue ?? chosen;
  const diagnosis = reviewDiagnosis(detail, t);
  const selectedDiagnosis = issue ? issueDiagnosis(detail, issue, t) : null;
  const photo = selectedDiagnosis ? selectedDiagnosis.attempt : issue?.latestAttempt;
  const item =
    selectedRequirement?.item ??
    detail.items?.find((i) =>
      i.requirements.some((r) => r.id === issue?.requirementId),
    );
  const requirement =
    selectedRequirement ??
    item?.requirements.find((r) => r.id === issue?.requirementId) ??
    issue?.requirement;
  const timezone = detail.location?.timezone ?? "Asia/Karachi";
  function selectIssue(issueId: number) {
    setParams((old) => {
      const n = new URLSearchParams(old);
      n.set("issueId", String(issueId));
      n.delete("requirementId");
      return n;
    });
  }
  function selectRequirement(requirementId: string) {
    setParams((old) => {
      const n = new URLSearchParams(old);
      n.set('requirementId', requirementId);
      n.delete('issueId');
      return n;
    });
  }
  const guidance = detail.standards?.filter(s => !s.areaItemId || s.areaItemId === item?.sourceAreaItemId) ?? [];
  const contextPhotos = detail.attempts?.filter(attempt => attempt.contextKey) ?? [];
  const selectedRow = diagnosis.rows.find(row => row.id === requirement?.id);
  const photoName = `${item?.nameSnapshot ?? detail.area?.name ?? t('Room photo')} · ${requirement ? reviewViewLabel(requirement.viewKey, t) : t(plainReason(photo?.contextKey ?? 'Photo'))}`;
  const keptDirtyPhoto = photo?.mediaAssetId && ['SAFE', 'NOT_REQUIRED'].includes(photo.privacyState ?? '') && (
    selectedDiagnosis?.category === 'cleaning' ||
    (selectedDiagnosis?.category === 'review' && !detail.requiresFollowUp &&
      issue?.reasonCode === 'CLEANING_REQUIRED' && photo.state === 'CLEANING_REQUIRED') ||
    (!selectedDiagnosis && (issue?.reasonCode === 'CLEANING_REQUIRED' || requirement?.state === 'CLEANING_REQUIRED' || photo.state === 'CLEANING_REQUIRED'))
  );
  const photoRequirementId = requirement?.id ?? issue?.requirementId;
  const acceptanceAvailable = keptDirtyPhoto && photo && photoRequirementId &&
    detail.state !== 'RESOLVED' && issue?.state !== 'RESOLVED' && issue?.allowedActions?.includes('ACCEPT_EVIDENCE');
  const acceptanceError = acceptPhoto.isError && acceptPhoto.variables?.evidenceAttemptId === photo?.id;
  return (
    <div className="wx-review-detail" ref={root}>
      <nav className="wx-case-navigation" aria-label={t('Review navigation')}>
        <Link className="wx-case-link" to={returnTo} state={returnState}>
          <ArrowLeft size={16} aria-hidden="true" />
          {t(returnTo.startsWith('/exceptions') ? 'Back to reviews' : 'Back')}
        </Link>
        {nextReviewHref ? <Button asChild variant="outline">
          <Link to={nextReviewHref} state={returnState}>
            {t(detail.state === 'RESOLVED' ? 'Next pending review' : 'Next review')}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </Button> : <Button variant="outline" disabled={next.isFetching} aria-busy={next.isFetching} onClick={() => void next.refetch()}>
          {t('Check for next review')}
        </Button>}
      </nav>
      <header className="wx-case-header">
        <div>
          <h2>{detail.area?.name ?? detail.task?.areaNameSnapshot ?? t('Room setup')}</h2>
          {detail.task && <p className="wx-case-task"><bdi>{detail.task.title}</bdi></p>}
          <div className="wx-case-meta">
            <span><MapPin size={16} aria-hidden="true" /><bdi>{detail.location?.name}</bdi></span>
            {detail.kind !== 'SETUP' && detail.task && <span><UserRound size={16} aria-hidden="true" /><bdi>{detail.task.staff?.name ?? t('Unassigned')}</bdi></span>}
            {detail.task?.shiftEnd && <span><Clock3 size={16} aria-hidden="true" /><time dateTime={detail.task.shiftEnd}><bdi>{localTime(detail.task.shiftEnd, timezone, language, true)}</bdi></time></span>}
          </div>
        </div>
        <div className="wx-case-status">
          <StatusPill tone={detail.state === 'RESOLVED' ? 'neutral' : ['OPEN', 'MANAGER_REVIEW'].includes(detail.state) ? 'attention' : 'neutral'}>{exceptionStateLabel(detail.state)}</StatusPill>
          <StatusPill tone={detail.task?.staffSubmittedAt ? 'progress' : 'neutral'}>
            {detail.kind === 'SETUP' ? 'No task generated' : !detail.task ? 'Task submission information unavailable' : detail.task.staffSubmittedAt ? 'Task submitted' : 'Task not submitted'}
          </StatusPill>
        </div>
      </header>
      <OperationsState error={query.error} retry={() => void query.refetch()} />
      {!online && <p className="wx-case-notice" role="status">{t('Internet needed to save a decision. Reconnect and try again. Your note stays on this page.')}</p>}
      {notice && <div className="wx-case-notice wx-case-save-result" role="status">
        <CheckCircle2 size={20} aria-hidden="true" /><div><strong>{t(notice)}</strong><p>{t('{count} unresolved issues remain', { count: open.length })}</p></div>
      </div>}
      <ReviewSummary detail={detail} onSelect={selectRequirement} />
      {detail.kind === 'SETUP' ? <section className="wx-case-setup">
        <h2>{t('Room inventory needs setup')}</h2>
        <p>{t('Configure the room and its schedule. Photos cannot be reviewed until the inventory is ready.')}</p>
        <p role="status">{t('Complete the room setup before reviewing task photos. No staff decision is available for this setup record.')}</p>
        <div className="wx-case-actions"><Button asChild><Link to={`/locations/${detail.locationId}?tab=templates`}>{t('Review room setup')}</Link></Button>
          <Button variant="outline" disabled={query.isFetching} aria-busy={query.isFetching} onClick={() => void done()}>{t('Check again')}</Button></div>
      </section> : <>
        <section className="wx-case-evidence" aria-label={t('Required photo views')}>
          <h3>{t('All required photos')}</h3>
          {diagnosis.rows.length ? <div className="wx-case-evidence-grid">
            {diagnosis.rows.map(row => <article className="wx-case-view" key={row.id}
              id={`review-view-${encodeURIComponent(row.id)}`} tabIndex={-1}
              aria-label={`${row.name} · ${row.view}`} aria-current={requirement?.id === row.id ? 'true' : undefined}>
              <button type="button" className="wx-case-view-photo" onClick={() => selectRequirement(row.id)}
                aria-pressed={requirement?.id === row.id} aria-label={t('Inspect {name}: {view}', { name: row.name, view: row.view })}>
                <EvidencePhoto photo={row.attempt} name={`${row.name} · ${row.view}`} missing={row.category === 'missing'} description={row.description} thumbnail />
              </button>
              <div className="wx-case-view-caption"><strong><bdi>{row.name}</bdi></strong>
                <span>{row.view}{!row.mandatory && ` · ${t('Optional')}`}</span>
                <StatusPill tone={evidenceTone(row.category)}>{row.title}</StatusPill>
              </div>
            </article>)}
          </div> : <p className="wx-case-empty">{t('The review summary above lists the affected fixtures and missing photos.')}</p>}
        </section>
        {(visibleIssues.length > 1 || visibleIssues.some(row => !row.requirementId)) && <div className="wx-case-issues" role="group" aria-label={t('Issues in this review')}>
          {visibleIssues.map(row => <button type="button" id={`review-issue-${row.id}`} key={row.id}
            aria-pressed={!requirementIssue && issue?.id === row.id} onClick={() => selectIssue(row.id)}>{t(plainReason(row.reasonCode))}</button>)}
        </div>}
        <section className="wx-case-inspection" id="review-evidence" tabIndex={-1} aria-label={t('Review photo')}>
          <div className="wx-case-inspection-heading"><div><h3>{item?.nameSnapshot ?? issue?.requirement?.item?.nameSnapshot ?? t('Task photos')}</h3>
            <p>{requirement ? reviewViewLabel(requirement.viewKey, t) : t('Room and fixture evidence')}</p></div>
            <StatusPill tone={evidenceTone(keptDirtyPhoto ? 'cleaning' : selectedDiagnosis?.category ?? selectedRow?.category)}>{keptDirtyPhoto ? plainReason('CLEANING_REQUIRED') : selectedDiagnosis?.title ?? selectedRow?.title ?? plainReason(photo?.state ?? requirement?.state ?? 'MISSING')}</StatusPill>
          </div>
          {(selectedDiagnosis ?? selectedRow) && <p className="wx-case-explanation">{(selectedDiagnosis ?? selectedRow)?.description}</p>}
          <EvidencePhoto photo={photo} name={photoName} missing={selectedDiagnosis?.category === 'missing' || selectedRow?.category === 'missing'} description={selectedDiagnosis?.description ?? selectedRow?.description ?? diagnosis.next} />
          {photo?.receivedAt && <p className="wx-case-photo-caption">{t('Received')} <time dateTime={photo.receivedAt}><bdi>{localTime(photo.receivedAt, timezone, language, true)}</bdi></time></p>}
          {keptDirtyPhoto && <p className="wx-case-explanation">{t('AI result: more cleaning needed. You can accept this photo if it is clean.')}</p>}
          {acceptanceAvailable && <div className="wx-decision">
            <form key={`${id}:${issue.id}:${photo.id}`} className="wx-decision-form" aria-busy={acceptPhoto.isPending} onSubmit={event => {
              event.preventDefault();
              if (!online || query.isError || acceptPhoto.isPending) return;
              const form = event.currentTarget;
              const note = String(new FormData(form).get('note') ?? '').trim();
              if (!note) return;
              const input = {
                expectedVersion: detail.rowVersion,
                ...(issue.id > 0 ? { issueId: issue.id } : {}),
                requirementId: photoRequirementId,
                evidenceAttemptId: photo.id,
                action: 'ACCEPT_EVIDENCE' as const,
                reasonCode: 'CLEAN',
                note,
              };
              const decision = JSON.stringify({ id, ...input });
              if (pendingAcceptance.current?.decision !== decision) {
                pendingAcceptance.current = { decision, requestId: crypto.randomUUID() };
              }
              acceptPhoto.mutate({ ...input, requestId: pendingAcceptance.current.requestId }, { onSuccess: () => form.reset() });
            }}>
              <label className="wx-decision-field">
                {t('What did you check?')}
                <textarea name="note" rows={2} required maxLength={1000} disabled={acceptPhoto.isPending}
                  onChange={event => event.currentTarget.setCustomValidity(event.currentTarget.value.trim() ? '' : t('Add a note before saving.'))} />
              </label>
              {acceptanceError && <p role="alert" className="wx-decision-error">{t(acceptPhoto.error.response?.status === 409
                ? 'This review changed. Refresh before saving. Your note is kept.'
                : 'Could not save your decision. Check your connection and try again.')}</p>}
              <div className="wx-decision-footer">
                <Button type="submit" variant="outline" className="wx-decision-button" disabled={!online || query.isError || acceptPhoto.isPending}>
                  {t(acceptPhoto.isPending ? 'Saving decision…' : reviewActionLabels.ACCEPT_EVIDENCE)}
                </Button>
              </div>
            </form>
          </div>}
          {requirement && <div className="wx-case-instructions"><h4>{t('What this photo must show')}</h4><p><bdi>{requirement.instructionsSnapshot}</bdi></p></div>}
          {guidance.length > 0 && <details className="wx-case-disclosure" onToggle={event => setGuidanceOpen(event.currentTarget.open)}>
            <summary>{t('Example guidance')}</summary>
            {guidanceOpen && <div><p>{t('Current room guidance. Task requirements above remain unchanged.')}</p>
              {guidance.map(standard => <div key={standard.id}><p><bdi>{standard.caption}</bdi></p><ProtectedEvidence assetId={standard.mediaAssetId} privacyState="SAFE" alt={standard.caption ?? t('Example guidance')} /></div>)}
            </div>}
          </details>}
          {contextPhotos.length > 0 && <details className="wx-case-disclosure" onToggle={event => setContextOpen(event.currentTarget.open)}>
            <summary>{t('Room context photos')}</summary>
            {contextOpen && <div>{contextPhotos.map(attempt => <div key={attempt.id}>
              <p>{t(plainReason(attempt.contextKey!))}</p>
              {attempt.mediaAssetId ? <ProtectedEvidence assetId={attempt.mediaAssetId} privacyState={attempt.privacyState} allowRestrictedReview /> : <p>{t('Privacy check pending. Photo is not available for routine review yet.')}</p>}
            </div>)}</div>}
          </details>}
        </section>
        <LaunchReviewContext detail={detail} replacement={requirements.find(row => row.id === requirement?.id)?.replacement} />
        <section className="ops-panel ops-action-column v5-decision-card" id="review-finding" tabIndex={-1}>
          <div className="ops-panel-body"><DecisionForm detail={detail} onDone={done} nextReviewHref={nextReviewHref} unavailable={query.isError} /></div>
        </section>
      </>}
    </div>
  );
}
