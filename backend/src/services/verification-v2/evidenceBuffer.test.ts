import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { saveBufferedPhoto, readBufferedPhoto, removeBufferedPhoto, reviewableMedia } from './evidenceBuffer.js';
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'hygene-buffer-test-')); process.env.EVIDENCE_BUFFER_DIR = directory; process.env.EVIDENCE_BUFFER_KEY = 'isolated-test'; });
afterEach(async () => { await rm(directory, { force: true, recursive: true }); delete process.env.EVIDENCE_BUFFER_DIR; delete process.env.EVIDENCE_BUFFER_KEY; });
it('encrypts bytes, binds tenant/capture, allows identical retry and removes only that capture', async () => {
  const id = randomUUID(), bytes = Buffer.from('private photo bytes');
  await saveBufferedPhoto(1, id, bytes);
  expect((await readFile(join(directory, `1-${id}.bin`))).includes(bytes)).toBe(false);
  expect(await readBufferedPhoto(1, id)).toEqual(bytes);
  await saveBufferedPhoto(1, id, bytes);
  await expect(saveBufferedPhoto(1, id, Buffer.from('replacement'))).rejects.toThrow('Different bytes');
  await expect(readBufferedPhoto(2, id)).rejects.toThrow();
  await removeBufferedPhoto(1, id); await removeBufferedPhoto(1, id);
  await expect(readBufferedPhoto(1, id)).rejects.toThrow();
});
it('rejects traversal and exposes only cloud-ready new photos or legacy SAFE photos', async () => {
  await expect(saveBufferedPhoto(1, '../secrets', Buffer.from('x'))).rejects.toThrow();
  for (const state of ['PENDING', 'HOLD', 'BUFFERED', 'DISCARDED', undefined]) expect(reviewableMedia(state)).toBe(false);
  expect(reviewableMedia('SAFE')).toBe(true); expect(reviewableMedia('NOT_REQUIRED')).toBe(true);
});
