import { Agent } from 'node:https';
import cloudinary, { uploadBufferToCloudinary } from '../../utils/cloudinary.js';
import { ApiError } from '../../utils/ApiError.js';
import { IMAGE_LIMIT_BYTES } from './quality.service.js';

// One warm connection pool for every photo; Node's default pool drops idle sockets after 5 s.
const storageAgent = new Agent({ keepAlive: true, timeout: 60_000 });
/** A failure that ends within this window is retried once; a slow one is not, so the request stays far under the phone's 120 s. */
export const STORAGE_RETRY_WINDOW_MS = 10_000;
export const STORAGE_RETRY_DELAY_MS = 1_000;
const statusOf = (error: unknown) => (error as { error?: { http_code?: number }; http_code?: number })?.error?.http_code ?? (error as { http_code?: number })?.http_code;
/** Network errors, timeouts, rate limits and 5xx are transient; any other HTTP answer is definitive. */
export function transientStorageFailure(error: unknown) {
  const status = statusOf(error);
  if (typeof status === 'number') return status >= 500 || status === 429 || status === 420 || status === 499;
  return error instanceof Error || (error as { name?: string })?.name === 'TimeoutError';
}
async function retryOnce<T>(work: () => Promise<T>) {
  const started = Date.now();
  try { return await work(); } catch (error) {
    if (!transientStorageFailure(error) || Date.now() - started > STORAGE_RETRY_WINDOW_MS) throw error;
    await new Promise(resolve => setTimeout(resolve, STORAGE_RETRY_DELAY_MS));
    return work();
  }
}
async function storedMatch(publicId: string, boundHash: string) {
  const existing = await cloudinary.api.resource(publicId, { type: 'authenticated', resource_type: 'image', context: true, timeout: 30_000, agent: storageAgent });
  if (existing.context?.custom?.sha256 !== boundHash) throw new ApiError(409, 'Stored evidence does not match this capture');
  return existing;
}

/** Existing storage account, authenticated assets only; never publish delivery URLs.
 * `lookup:false` is for an attempt no earlier request claimed: its random public id cannot exist yet. */
export async function storePrivateImage(bytes: Buffer, publicId: string, boundHash: string, { lookup = true }: { lookup?: boolean } = {}) {
  if (lookup) try {
    return await storedMatch(publicId, boundHash);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (statusOf(error) !== 404) throw new ApiError(503, 'Photo storage is temporarily unavailable');
  }
  let uploaded: Awaited<ReturnType<typeof uploadBufferToCloudinary>>;
  try {
    uploaded = await retryOnce(() => uploadBufferToCloudinary(bytes, { public_id: publicId, type: 'authenticated', resource_type: 'image', overwrite: false, timeout: 30_000,
      context: { sha256: boundHash }, agent: storageAgent }));
  } catch { throw new ApiError(503, 'Photo upload could not be confirmed. Retry this same capture.'); }
  if (!uploaded.existing) return uploaded;
  // overwrite:false returned an asset that was already there: accept it only if it is these bytes.
  try { return await storedMatch(publicId, boundHash); } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'Photo storage is temporarily unavailable');
  }
}

/** Deletes copies of a photo the check did not keep. One retry; a failure is logged, never thrown. */
export async function discardPrivateImages(publicIds: string[]) {
  const options = { type: 'authenticated' as const, resource_type: 'image' as const, invalidate: true, timeout: 10_000, agent: storageAgent };
  await Promise.all(publicIds.map(async publicId => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await cloudinary.uploader.destroy(publicId, options);
        if (result?.result === 'ok' || result?.result === 'not found') return;
      } catch { /* retried once, then logged */ }
    }
    console.warn(JSON.stringify({ type: 'VERIFICATION_STORAGE', event: 'DISCARD_FAILED', publicId }));
  }));
}

export async function privateImageBytes(publicId: string, format: string): Promise<Buffer> {
  if (!/^verification\/[\w\/-]+$/.test(publicId) || !['jpeg', 'jpg', 'png', 'webp'].includes(format)) throw new ApiError(404, 'Evidence unavailable');
  const url = cloudinary.utils.private_download_url(publicId, format, { type: 'authenticated', resource_type: 'image', expires_at: Math.floor(Date.now() / 1000) + 60 });
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
  if (!response.ok) throw new ApiError(503, 'Evidence storage is temporarily unavailable');
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError(503, 'Evidence storage returned no image');
  const chunks: Buffer[] = []; let size = 0;
  for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
    if (size > IMAGE_LIMIT_BYTES) { await reader.cancel(); throw new ApiError(503, 'Stored image exceeds the allowed size'); } chunks.push(Buffer.from(part.value)); }
  return Buffer.concat(chunks);
}
