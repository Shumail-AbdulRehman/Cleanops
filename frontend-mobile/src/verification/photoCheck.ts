// Spec 72: the stages a new task photo goes through after the shutter, and one honest percentage across them.
// Pure data and helpers only: the screen moves the stage when the real work moves; nothing here waits.

/** Working stages in order, then the endings (100%). */
export type PhotoCheckStage = 'quality' | 'upload' | 'ai' | 'received' | 'retake' | 'clean' | 'failed';
/** One photo's check: `since` is when the current stage began; `fraction` is the share of bytes sent (0 to 1). */
export type PhotoCheck = { id: number; stage: PhotoCheckStage; since: number; fraction: number };

export const WORKING_STAGES: readonly PhotoCheckStage[] = ['quality', 'upload', 'ai'];

/** English keys (Urdu in `staffAppTranslations.ts`). The endings reuse the result sheets' titles. */
export const checkLabels: Record<PhotoCheckStage, string> = {
  quality: 'Checking photo quality',
  upload: 'Uploading photo',
  ai: 'Checking with AI',
  received: 'Photo uploaded',
  retake: 'Take this photo again',
  clean: 'This still needs cleaning',
  failed: 'Photo check could not finish',
};

const QUALITY_EASE_MS = 1200;
const AI_EASE_MS = 5000;
const eased = (elapsedMs: number, easeMs: number) => 1 - Math.exp(-Math.max(0, elapsedMs) / easeMs);

/**
 * Quality 0 to 14 eased with time; upload 15 to 60 from the real bytes; AI 60 to 94 eased with time and
 * never further; any ending 100. Whole numbers.
 */
export function checkPercent(check: Pick<PhotoCheck, 'stage' | 'since' | 'fraction'>, now: number): number {
  const elapsed = now - check.since;
  switch (check.stage) {
    case 'quality': return Math.min(14, Math.floor(15 * eased(elapsed, QUALITY_EASE_MS)));
    case 'upload': return 15 + Math.floor(45 * Math.min(1, Math.max(0, Number.isFinite(check.fraction) ? check.fraction : 0)));
    case 'ai': return Math.min(94, 60 + Math.floor(35 * eased(elapsed, AI_EASE_MS)));
    default: return 100;
  }
}

/** The ending for an upload answer: problems by name, anything else is received. */
export function checkOutcome(state: string | undefined): PhotoCheckStage {
  if (state === 'RECAPTURE_REQUIRED') return 'retake';
  if (state === 'CLEANING_REQUIRED') return 'clean';
  if (state === 'SERVICE_FAILURE') return 'failed';
  return 'received';
}

/**
 * The next check after bytes were sent. Only the upload stage moves: all bytes sent starts the AI stage,
 * so a quick upload skips ahead. Same object when the shown percentage would not change, so the screen does not redraw.
 */
export function withUploadProgress(check: PhotoCheck | null, fraction: number, now: number): PhotoCheck | null {
  if (!check || check.stage !== 'upload' || !Number.isFinite(fraction)) return check;
  if (fraction >= 0.999) return { ...check, stage: 'ai', since: now, fraction: 1 };
  const next = Math.min(1, Math.max(0, fraction));
  return Math.floor(45 * next) === Math.floor(45 * check.fraction) ? check : { ...check, fraction: next };
}

/** A check moved to `stage`, timed from `now`. Never goes back to an earlier working stage. */
export function checkAt(check: PhotoCheck | null, stage: PhotoCheckStage, now: number): PhotoCheck | null {
  if (!check) return null;
  const from = WORKING_STAGES.indexOf(check.stage), to = WORKING_STAGES.indexOf(stage);
  if (from < 0 || (to >= 0 && to <= from)) return check;
  return { ...check, stage, since: now, fraction: stage === 'upload' ? 0 : check.fraction };
}
