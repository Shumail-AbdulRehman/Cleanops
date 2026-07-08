import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma } from '../../prisma/prisma.js';
import { bufferRoot, removeBufferedPhoto, photoStorageState } from './evidenceBuffer.js';

let cursor = 0;
/** Recover cleanup after a crash. Never expire evidence with a live/retry job. */
export async function cleanupEvidenceBuffers() {
  const files = await readdir(bufferRoot()).catch(() => [] as string[]);
  if (!files.length) return;
  const selected = files.sort().slice(cursor, cursor + 100);
  cursor = cursor + 100 >= files.length ? 0 : cursor + 100;
  const ids=selected.flatMap(file=>/^(\d+)-([a-f0-9-]{36})\.bin$/i.exec(file)?.[2]??[]);
  const attempts=await prisma.verificationAttempt.findMany({where:{id:{in:ids}},select:{id:true,media:{select:{companyId:true,deliveryType:true,privacyState:true}},jobs:{where:{stage:'PHOTO'},select:{state:true}}}});
  const byId=new Map(attempts.map(a=>[a.id,a]));
  for (const file of selected) {
    const match = /^(\d+)-([a-f0-9-]{36})\.bin$/i.exec(file);
    if (!match) {
      if (/\.tmp$/.test(file)) {
        const metadata=await stat(join(bufferRoot(),file)).catch(()=>null);
        if(metadata&&Date.now()-metadata.mtimeMs>24*60*60*1000)await unlink(join(bufferRoot(),file)).catch(()=>{});
      }
      continue;
    }
    const companyId = Number(match[1]), attemptId = match[2]!;
    const found=byId.get(attemptId);
    const attempt=found?.media?.companyId===companyId?found:undefined;
    const completed = ['cloud', 'discarded'].includes(photoStorageState(attempt?.media) ?? '');
    const active = attempt?.jobs.some(j => ['PENDING', 'RUNNING', 'RETRY_WAIT'].includes(j.state));
    const metadata = await stat(join(bufferRoot(), file)).catch(() => null);
    const expired = metadata && Date.now() - metadata.mtimeMs > 24 * 60 * 60 * 1000;
    if (completed || expired && !active) await removeBufferedPhoto(companyId, attemptId);
  }
}
