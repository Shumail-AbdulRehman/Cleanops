import { z } from 'zod';
import { ProviderServiceFailure } from './provider.service.js';

export const CLEAN_BAND_EDGE = 0.20;
export const DIRTY_BAND_EDGE = 0.80;

const configurationSchema = z.object({
  mode: z.enum(['clef', 'local-model']).default('clef'),
  url: z.url({ protocol: /^https?$/ }).default('http://127.0.0.1:8765'),
  timeoutMs: z.coerce.number().int().min(100).max(60000).default(15000),
  modelId: z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/).default('cleandirty-4cat-dinov2-20261117'),
});

const dirtyScoreSchema = z.number().finite().min(0).max(1);
const scoreResponseSchema = z.object({
  pDirty: dirtyScoreSchema,
  modelVersion: z.string().refine((value) => value.trim().length > 0),
  latencyMs: z.number().int().nonnegative(),
});

export type CleanlinessBand = 'CLEAN' | 'DIRTY' | 'REVIEW';
export type LocalCleanlinessUnavailableReason =
  | 'PROVIDER_CONFIGURATION_INVALID'
  | 'TIMEOUT'
  | 'CONNECTION_ERROR'
  | 'HTTP_ERROR'
  | 'INVALID_JSON'
  | 'INVALID_SCORE'
  | 'INVALID_RESPONSE';

export type LocalCleanlinessResult =
  | { status: 'SCORED'; pDirty: number; band: CleanlinessBand; modelVersion: string; latencyMs: number }
  | { status: 'UNAVAILABLE'; reason: LocalCleanlinessUnavailableReason; latencyMs: number };

export function localCleanlinessConfiguration() {
  const parsed = configurationSchema.safeParse({
    mode: process.env.CLEANLINESS_PROVIDER,
    url: process.env.LOCAL_CLEANLINESS_URL,
    timeoutMs: process.env.LOCAL_CLEANLINESS_TIMEOUT_MS,
    modelId: process.env.LOCAL_CLEANLINESS_MODEL_ID,
  });
  if (!parsed.success) throw new ProviderServiceFailure('PROVIDER_CONFIGURATION_INVALID');
  return parsed.data;
}

export function isLocalCleanlinessEnabled(): boolean {
  const mode = configurationSchema.shape.mode.safeParse(process.env.CLEANLINESS_PROVIDER);
  if (!mode.success) throw new ProviderServiceFailure('PROVIDER_CONFIGURATION_INVALID');
  return mode.data === 'local-model';
}

export function localCleanlinessVersionPart(): string {
  const { mode, modelId } = localCleanlinessConfiguration();
  return `${mode}:${modelId}:${CLEAN_BAND_EDGE}:${DIRTY_BAND_EDGE}`;
}

export function cleanlinessBand(pDirty: number): CleanlinessBand {
  if (pDirty < CLEAN_BAND_EDGE) return 'CLEAN';
  if (pDirty >= DIRTY_BAND_EDGE) return 'DIRTY';
  return 'REVIEW';
}

function isTimeout(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name));
}

export async function scoreLocalCleanliness(jpeg: Buffer): Promise<LocalCleanlinessResult> {
  const started = performance.now();
  const unavailable = (reason: LocalCleanlinessUnavailableReason): LocalCleanlinessResult => ({
    status: 'UNAVAILABLE',
    reason,
    latencyMs: Math.round(performance.now() - started),
  });

  let signal: AbortSignal | undefined;
  let response: Response;
  try {
    const { url, timeoutMs } = localCleanlinessConfiguration();
    const endpoint = new URL(url);
    endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}/score`;
    signal = AbortSignal.timeout(timeoutMs);
    response = await fetch(endpoint.href, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: new Uint8Array(jpeg),
      signal,
      redirect: 'manual',
    });
  } catch (error) {
    if (error instanceof ProviderServiceFailure) return unavailable('PROVIDER_CONFIGURATION_INVALID');
    return unavailable(isTimeout(error, signal) ? 'TIMEOUT' : 'CONNECTION_ERROR');
  }

  if (response.status !== 200) {
    void response.body?.cancel().catch(() => undefined);
    return unavailable('HTTP_ERROR');
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (error) {
    if (isTimeout(error, signal)) return unavailable('TIMEOUT');
    return unavailable(error instanceof SyntaxError ? 'INVALID_JSON' : 'CONNECTION_ERROR');
  }

  const result = scoreResponseSchema.safeParse(raw);
  if (!result.success) {
    return unavailable(result.error.issues.some(({ path }) => path[0] === 'pDirty' || path.length === 0)
      ? 'INVALID_SCORE'
      : 'INVALID_RESPONSE');
  }
  return { status: 'SCORED', ...result.data, band: cleanlinessBand(result.data.pDirty) };
}
