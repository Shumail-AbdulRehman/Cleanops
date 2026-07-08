import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, link, unlink, statfs } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { ApiError } from '../../utils/ApiError.js';

export const bufferRoot = () => resolve(process.env.EVIDENCE_BUFFER_DIR ?? './var/evidence-buffer');
function key() {
  const secret = process.env.EVIDENCE_BUFFER_KEY || process.env.ACCESS_TOKEN_SECRET;
  if (!secret) throw new ApiError(503, 'Photo processing storage is not configured. Your photo remains on this phone.');
  return createHash('sha256').update('hygene-evidence-buffer-v1\0' + secret).digest();
}
function path(companyId: number, attemptId: string) {
  if (!Number.isInteger(companyId) || companyId < 1 || !/^[a-f0-9-]{36}$/i.test(attemptId)) throw new Error('Invalid buffer identity');
  return join(bufferRoot(), `${companyId}-${attemptId}.bin`);
}
export async function saveBufferedPhoto(companyId: number, attemptId: string, bytes: Buffer) {
  await mkdir(bufferRoot(), { recursive: true, mode: 0o700 });
  const space = await statfs(bufferRoot());
  if (space.bavail * space.bsize < bytes.length + 100 * 1024 * 1024) throw new ApiError(503, 'Photo processing storage is full. Your photo stays on this phone. Try again shortly.');
  const target = path(companyId, attemptId), temporary = `${target}.${randomUUID()}.tmp`;
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(`${companyId}:${attemptId}`));
  const encoded = Buffer.concat([iv, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(encoded); await file.sync(); } catch (error) { await unlink(temporary).catch(() => {}); throw error; } finally { await file.close(); }
  try {
    // Atomic creation: concurrent retries cannot replace an existing capture.
    await link(temporary, target);
    const directory = await open(bufferRoot(), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (!bytes.equals(await readBufferedPhoto(companyId, attemptId))) throw new ApiError(409, 'Different bytes require a new photo.');
  } finally { await unlink(temporary).catch(() => {}); }
}
export async function readBufferedPhoto(companyId: number, attemptId: string) {
  const encoded = await readFile(path(companyId, attemptId));
  const decipher = createDecipheriv('aes-256-gcm', key(), encoded.subarray(0, 12));
  decipher.setAAD(Buffer.from(`${companyId}:${attemptId}`));
  decipher.setAuthTag(encoded.subarray(-16));
  return Buffer.concat([decipher.update(encoded.subarray(12, -16)), decipher.final()]);
}
export async function removeBufferedPhoto(companyId: number, attemptId: string) {
  await unlink(path(companyId, attemptId)).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
// NOT_REQUIRED applies only to newly processed photos with privacy assessment removed.
// Existing HOLD/PENDING evidence keeps its existing access restrictions.
export const reviewableMedia = (state?: string | null) => state === 'SAFE' || state === 'NOT_REQUIRED';

export const photoStorageState = (media?: { privacyState?: string | null; deliveryType?: string | null } | null) =>
  !media ? null : media.privacyState === "BUFFERED" ? "buffered" : media.privacyState === "DISCARDED" ? "discarded" : media.deliveryType === "authenticated" ? "cloud" : null;
