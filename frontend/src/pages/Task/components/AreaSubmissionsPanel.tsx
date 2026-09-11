import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useGetAreaSubmissions } from "../queries";
import type { AreaMatchStatus, AreaSubmission } from "../types";

const MATCH_BADGE: Record<AreaMatchStatus, { label: string; cls: string }> = {
  passed: { label: "Area Match: Passed", cls: "bg-emerald-50 text-emerald-700" },
  flagged: { label: "Area Match: Needs Review", cls: "bg-amber-50 text-amber-700" },
  blocked: { label: "Area Match: Failed", cls: "bg-red-50 text-red-700" },
};

const MatchBadge = ({ status }: { status: AreaMatchStatus | null }) => {
  const badge = status
    ? MATCH_BADGE[status] ?? { label: status, cls: "bg-gray-100 text-gray-600" }
    : { label: "Awaiting photo", cls: "bg-gray-100 text-gray-600" };

  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.cls}`}>
      {badge.label}
    </span>
  );
};

const fmtPct = (score: number | null | undefined) =>
  score == null ? null : `${Math.round(score * 100)}%`;

const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString() : "—";

const AreaSubmissionCard = ({ submission }: { submission: AreaSubmission }) => {
  const [showAttempts, setShowAttempts] = useState(false);
  const similarityPct = fmtPct(submission.similarityScore);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            {submission.referenceImage?.name ?? `Area #${submission.referenceImageId}`}
          </p>
          <p className="text-xs text-gray-500">{submission.staff?.name ?? "Unknown staff"}</p>
        </div>
        <div className="flex items-center gap-2">
          {similarityPct && (
            <span className="text-xs font-semibold text-gray-700">{similarityPct} similar</span>
          )}
          <MatchBadge status={submission.areaMatchStatus} />
        </div>
      </div>

      {submission.photoUrl && (
        <div className="mt-3 flex items-center gap-3">
          <a href={submission.photoUrl} target="_blank" rel="noopener noreferrer">
            <img
              src={submission.photoUrl}
              alt="Staff photo"
              className="h-16 w-16 rounded-md border border-gray-200 object-cover transition-all hover:ring-2 hover:ring-teal-400"
            />
          </a>
          <span className="text-xs font-medium text-gray-400">vs</span>
          {submission.referenceImage?.imageUrl ? (
            <a href={submission.referenceImage.imageUrl} target="_blank" rel="noopener noreferrer">
              <img
                src={submission.referenceImage.imageUrl}
                alt={`Reference: ${submission.referenceImage.name}`}
                className="h-16 w-16 rounded-md border border-gray-200 object-cover transition-all hover:ring-2 hover:ring-teal-400"
              />
            </a>
          ) : (
            <span className="text-xs text-gray-400">No reference photo</span>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-2">
        <span className="text-[10px] text-gray-400">
          Uploaded {fmtTime(submission.uploadedAt ?? submission.scannedAt)}
        </span>
        {submission.attempts.length > 0 && (
          <button
            onClick={() => setShowAttempts((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 hover:underline"
          >
            {showAttempts ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            {submission.attempts.length} attempt{submission.attempts.length === 1 ? "" : "s"}
          </button>
        )}
      </div>

      {showAttempts && (
        <div className="mt-2 space-y-2 rounded-lg bg-gray-50 p-2">
          {submission.attempts.map((attempt, index) => (
            <div key={index} className="flex items-center gap-3">
              <a href={attempt.photoUrl} target="_blank" rel="noopener noreferrer">
                <img
                  src={attempt.photoUrl}
                  alt={`Attempt ${index + 1}`}
                  className="h-10 w-10 rounded-md border border-gray-200 object-cover"
                />
              </a>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <MatchBadge status={attempt.areaMatchStatus} />
                  {fmtPct(attempt.similarityScore) && (
                    <span className="text-[11px] font-semibold text-gray-700">
                      {fmtPct(attempt.similarityScore)} similar
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-gray-400">{fmtTime(attempt.at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const AreaSubmissionsPanel = ({ taskInstanceId }: { taskInstanceId: number }) => {
  const { data, isLoading, isError } = useGetAreaSubmissions(taskInstanceId);
  const submissions: AreaSubmission[] = data?.data ?? [];

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        Area Submissions
      </p>
      {isLoading ? (
        <p className="text-sm text-gray-400">Loading area submissions…</p>
      ) : isError ? (
        <p className="text-sm text-red-600">Failed to load area submissions.</p>
      ) : submissions.length === 0 ? (
        <p className="text-sm text-gray-400">No area submissions for this task yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {submissions.map((submission) => (
            <AreaSubmissionCard key={submission.id} submission={submission} />
          ))}
        </div>
      )}
    </div>
  );
};

export default AreaSubmissionsPanel;
