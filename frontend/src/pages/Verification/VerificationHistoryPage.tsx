import { useEffect, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { ArrowLeft, Camera, Clock3, MapPin, RefreshCw, TriangleAlert, UserRound } from "lucide-react";
import type { RootState } from "@/store/store";
import { useLanguage } from "@/i18n/context";
import PageHeader from "@/components/common/PageHeader";
import { StatusPill, type StatusPillTone } from "@/components/workspace/StatusPill";
import OperationsState from "../Manager/OperationsState";
import { localTime } from "../Manager/operations";
import { getVerification, getVerificationHistory } from "./api";
import ProtectedEvidence from "./ProtectedEvidence";
import { plainReason, verificationLabel } from "./presentation";
import type { EvidenceRequirement, VerificationManifest } from "./types";
import { client } from "@/api/client";
import AreaSubmissionsPanel from "../Task/components/AreaSubmissionsPanel";
import "./task-photos-v6.css";

type Task = {
  id: number; title: string; verificationVersion: number;
  staff?: { name: string } | null;
  verificationException?: { id: number; state: string } | null;
};
const SAFE_RETURN = /^\/(exceptions|dashboard|today-status|staff\/\d+|locations\/\d+)(\?|$)/;

export default function VerificationHistoryPage() {
  const id = Number(useParams().id);
  const { t } = useLanguage();
  if (!Number.isSafeInteger(id) || id < 1)
    return <p role="alert">{t("Task unavailable.")}</p>;
  return <TaskPhotos key={id} id={id} />;
}

function TaskPhotos({ id }: { id: number }) {
  const { t, language } = useLanguage();
  const [params, setParams] = useSearchParams();
  const scope = useSelector((s: RootState) => `${s.auth.user?.companyId}:${s.auth.user?.role}:${s.auth.user?.id}`);
  const cache = useQueryClient();
  const [denial, setDenial] = useState<{ error: unknown; taskUpdates: number; manifestUpdates: number } | null>(null);
  const candidate = params.get("returnTo");
  const returnTo = candidate && SAFE_RETURN.test(candidate) ? candidate : `/today-status?tab=tasks&taskId=${id}`;
  const taskKey = ["verification-task", scope, id];
  const manifestKey = ["verification", scope, id];
  const task = useQuery({
    queryKey: taskKey,
    queryFn: async ({ signal }) => (await client.get<{ data: Task }>(`/task-instance/${id}`, { signal })).data.data,
  });
  const caseId = task.data?.verificationVersion === 2 ? task.data.verificationException?.id : undefined;
  const manifest = useQuery({
    queryKey: manifestKey,
    queryFn: () => getVerification(id),
    enabled: task.data?.verificationVersion === 2 && !caseId,
    staleTime: 15000,
    gcTime: 60000,
    refetchOnWindowFocus: true,
  });
  const terminalError = [task.error, task.failureReason, manifest.error, manifest.failureReason].find(error =>
    [401, 403, 404, 410].includes((error as { response?: { status?: number } })?.response?.status ?? 0));
  const taskUpdates = cache.getQueryState(taskKey)?.dataUpdateCount ?? 0;
  const manifestUpdates = cache.getQueryState(manifestKey)?.dataUpdateCount ?? 0;
  // A retry can replace a denial with a connection error. Keep private content
  // hidden until every required read has succeeded again after that denial.
  // Update counts also distinguish successful identical responses in the same ms.
  if (terminalError && terminalError !== denial?.error) {
    setDenial({ error: terminalError, taskUpdates, manifestUpdates });
  } else if (denial && !terminalError && task.isSuccess && !task.isFetching && taskUpdates > denial.taskUpdates &&
    (task.data.verificationVersion !== 2 || (manifest.isSuccess && !manifest.isFetching && manifestUpdates > denial.manifestUpdates))) {
    setDenial(null);
  }
  const accessError = terminalError ?? denial?.error;
  useEffect(() => {
    if (accessError) cache.removeQueries({ queryKey: ["verification-history", scope, id], exact: true });
  }, [accessError, cache, scope, id]);
  const taskData = accessError ? undefined : task.data;
  const data = accessError ? undefined : manifest.data;
  const loading = task.isPending || (task.data?.verificationVersion === 2 && manifest.isPending);
  const error = task.error ?? manifest.error;
  const loaded = !!taskData && (taskData.verificationVersion !== 2 || !!data);
  const blocking = accessError ?? (loaded ? null : error);
  // Old bookmarks and staff/location links land in the complete workspace.
  // Use the authorized case identifier, never the task identifier.
  const destination = caseId ?? manifest.data?.exceptions[0]?.id;
  if (!blocking && destination && !task.isError && (caseId || !manifest.isError))
    return <Navigate replace to={`/exceptions/${destination}?returnTo=${encodeURIComponent(returnTo)}`} />;
  const fetching = task.isFetching || manifest.isFetching;
  const refresh = () => { if (fetching) return; void task.refetch(); if (task.data?.verificationVersion === 2) void manifest.refetch(); };
  const subtitle = [data?.task.title ?? taskData?.title, data?.task.location?.name].filter(Boolean).join(" · ");
  const areaName = data?.area?.name ?? data?.task.areaNameSnapshot;
  return <div className="wx-task-photos">
    <PageHeader
      title="Task photos"
      subtitle={subtitle || "Task photos and required views"}
      action={<div className="wx-task-photos-actions">
        <Link className="wx-task-photos-button" to={returnTo}><ArrowLeft size={18} aria-hidden="true" />{t("Back")}</Link>
        <button type="button" className="wx-task-photos-button" aria-disabled={fetching} onClick={refresh}>
          <RefreshCw size={16} aria-hidden="true" />{t("Refresh")}
        </button>
      </div>}
    />
    <OperationsState loading={loading} layout="verification" error={blocking} retry={refresh} />
    {!blocking && loaded && error ? <div className="wx-stale-notice wx-task-photos-stale" role="alert">
      <TriangleAlert size={18} aria-hidden="true" /><span>{t("You are viewing the last loaded information.")}</span>
      <button type="button" className="wx-task-photos-button" aria-disabled={fetching} onClick={refresh}><RefreshCw size={16} aria-hidden="true" />{t("Retry")}</button>
    </div> : null}
    {taskData ? <ul className="wx-task-photos-facts" aria-label={t("Task details")}>
      {areaName ? <li><MapPin size={16} aria-hidden="true" /><span>{t("Area")}</span><bdi>{areaName}</bdi></li> : null}
      {data ? <li><Clock3 size={16} aria-hidden="true" /><span>{t("Due")}</span><bdi>{localTime(data.task.shiftEnd, data.task.location?.timezone ?? "Asia/Karachi", language, true)}</bdi></li> : null}
      <li><UserRound size={16} aria-hidden="true" /><span>{t("Assigned to")}</span><bdi>{taskData.staff?.name ?? t("Unassigned")}</bdi></li>
    </ul> : null}
    {!blocking && data ? <PhotoWorkspace id={id} scope={scope} data={data} staffName={taskData?.staff?.name} selectedId={params.get("view")} select={(view) => setParams(old => { const next = new URLSearchParams(old); next.set("view", view); return next; }, { replace: true })} /> : null}
    {!blocking && taskData && taskData.verificationVersion !== 2 ? <section className="wx-task-photos-panel wx-task-photos-pad">
      <h2>{t("Task photos")}</h2><AreaSubmissionsPanel taskInstanceId={id} />
    </section> : null}
  </div>;
}

function viewTone(r: EvidenceRequirement): StatusPillTone {
  if (["PASSED", "ACCEPTED", "MANAGER_ACCEPTED", "WAIVED"].includes(r.state)) return "ok";
  if (["CLEANING_REQUIRED", "RETAKE_REQUIRED", "FAILED", "REJECTED"].includes(r.state)) return "bad";
  return r.currentAttempt ? "progress" : "neutral";
}

function PhotoWorkspace({ id, scope, data, staffName, selectedId, select }: {
  id: number; scope: string; data: VerificationManifest; staffName?: string; selectedId: string | null; select: (id: string) => void;
}) {
  const { t, language } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const zone = data.task.location?.timezone ?? "Asia/Karachi";
  const views = data.items.flatMap(item => item.requirements.map(requirement => ({ item, requirement })));
  const selected = views.find(v => v.requirement.id === selectedId) ?? views[0];
  const photo = selected?.requirement.currentAttempt;
  const required = views.filter(v => v.item.mandatory && v.requirement.mandatory);
  const received = required.filter(v => !!v.requirement.currentAttempt).length;
  const submittedAt = data.task.staffSubmittedAt;
  const verified = data.task.verificationState === "VERIFIED" || data.task.completionOutcome === "VERIFIED_COMPLETE";
  // Review state comes only from the review records, never from verification or completion.
  const reviews = data.exceptions ?? [];
  const reviewOpen = reviews.some(r => r.state !== "RESOLVED");
  const reviewClosed = reviews.length > 0 && !reviewOpen;
  const review = reviewOpen ? "open" : reviewClosed ? "closed" : "none";
  const history = useInfiniteQuery({
    queryKey: ["verification-history", scope, id],
    queryFn: ({ pageParam }) => getVerificationHistory(id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: page => page.nextCursor ?? undefined,
    enabled: expanded,
    gcTime: 60000,
    staleTime: 15000,
  });
  const viewName = (key?: string | null) => t(plainReason(key ?? "Photo"));
  return <div className="wx-task-photos-grid">
    <section className="wx-task-photos-panel wx-task-photos-main" aria-label={t("Selected photo")}>
      <div className="wx-task-photos-stage">
        {photo?.mediaAssetId ? <ProtectedEvidence key={photo.id} assetId={photo.mediaAssetId} privacyState={photo.privacyState} allowRestrictedReview alt={`${selected?.item.nameSnapshot} · ${viewName(selected?.requirement.viewKey)}`} /> : <div className="wx-evidence-state">
          <Camera size={28} aria-hidden="true" /><strong>{t(photo ? "This photo is not available for review yet." : "No photo received for this view")}</strong>
          <p>{t("Photos saved only on the worker’s phone appear after uploading.")}</p>
        </div>}
      </div>
      <div className="wx-task-photos-pad">
        <h2><bdi>{selected?.item.nameSnapshot ?? t("Task photos")}</bdi>{selected ? <span> · {viewName(selected.requirement.viewKey)}</span> : null}</h2>
        {selected ? <p className="wx-task-photos-muted">{t("What this photo must show: {description}", { description: `⁨${selected.requirement.instructionsSnapshot}⁩` })}</p> : null}
        {photo && selected ? <div className="wx-task-photos-result"><StatusPill tone={viewTone(selected.requirement)}>{plainReason(photo.manualOutcome ?? photo.state)}</StatusPill></div> : null}
        <p className="wx-task-photos-note">{t("Received photos may still need checking. Uploading a photo does not submit the task.")}</p>
      </div>
    </section>
    <aside className="wx-task-photos-side">
      <section className="wx-task-photos-panel wx-task-photos-pad" aria-label={t("Required photo views")}>
        <div className="wx-task-photos-heading"><h2>{t("Required photo views")}</h2><strong>{t("{received} of {total} required photos received", { received, total: required.length })}</strong></div>
        <p className="wx-task-photos-note">{t("Choose a view to inspect its photo.")}</p>
        {data.items.map(item => <div className="wx-task-photos-fixture" key={item.id}>
          <h3><bdi>{item.nameSnapshot}</bdi></h3>
          {item.requirements.map(r => <button type="button" key={r.id} className="wx-task-photos-view" aria-pressed={selected?.requirement.id === r.id} onClick={() => select(r.id)}>
            <span>{viewName(r.viewKey)}{!r.mandatory || !item.mandatory ? <small>{t("Optional")}</small> : null}</span>
            <StatusPill tone={viewTone(r)}>{plainReason(r.state)}</StatusPill>
          </button>)}
        </div>)}
        {!views.length ? <p className="wx-task-photos-note">{t("No photo requirements for this task.")}</p> : null}
      </section>
      <section className="wx-task-photos-panel wx-task-photos-pad" aria-label={t("Task and evidence status")}>
        <h2>{t("Task and evidence status")}</h2>
        <ol className="wx-task-photos-states">
          <li data-done={!!submittedAt}><b>{t("Submitted")}</b><small>{submittedAt
            ? <>{staffName ? <><bdi>{staffName}</bdi>, </> : null}<bdi>{localTime(submittedAt, zone, language, true)}</bdi></>
            : t("Not submitted")}</small></li>
          <li data-done={verified}><b>{t("Verified")}</b><small>{t(verified ? "The photos passed their checks." : verificationLabel(data.task))}</small></li>
          <li data-done={reviewClosed} data-state={review}><b>{t({ open: "Manager review needed", closed: "Review closed", none: "No open reviews" }[review])}</b><small>{t({ open: "A photo needs your review", closed: "Review closure records a manager decision. Required photos, staff submission and verified completion stay separate.", none: "No manager review is open for this task." }[review])}</small></li>
        </ol>
      </section>
      <details className="wx-task-photos-panel wx-task-photos-history" onToggle={e => setExpanded(e.currentTarget.open)}>
        <summary>{t("Previous photos and upload history")}</summary>
        {expanded ? <div className="wx-task-photos-pad">
          <OperationsState loading={history.isPending} error={history.error} retry={() => void history.refetch()} />
          {history.isSuccess && !history.data.pages.some(p => p.attempts.length) ? <p className="wx-task-photos-note">{t("No uploaded photos yet.")}</p> : null}
          {history.data?.pages.flatMap(p => p.attempts).map(a => <section key={a.id} className="wx-task-photos-entry">
            <h3><bdi>{a.requirement?.item.nameSnapshot ?? t("Room photo")}</bdi> · {viewName(a.requirement?.viewKey ?? a.contextKey ?? "Photo")}</h3>
            <p className="wx-task-photos-muted"><bdi>{localTime(a.createdAt, zone, language, true)}</bdi>{a.staff?.name ? <> · <bdi>{a.staff.name}</bdi></> : null} · {t(plainReason(a.manualOutcome ?? a.state))}</p>
            {a.mediaAssetId ? <ProtectedEvidence assetId={a.mediaAssetId} privacyState={a.privacyState} allowRestrictedReview /> : <p className="wx-task-photos-note">{t("This photo is not available for review yet.")}</p>}
          </section>)}
          {history.hasNextPage ? <button type="button" className="wx-task-photos-button" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>{t(history.isFetchingNextPage ? "Loading…" : "Load older photos")}</button> : null}
        </div> : null}
      </details>
    </aside>
  </div>;
}
