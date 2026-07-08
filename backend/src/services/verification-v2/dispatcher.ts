/** Refill a free slot immediately. A slow job never holds an entire worker batch. */
export async function dispatchVerificationJobs<T>(options: {
  claim: () => Promise<T | null>;
  process: (job: T) => Promise<unknown>;
  stopping: () => boolean;
  onError: (error: unknown) => void;
  concurrency?: number;
  idleMs?: number;
}) {
  const concurrency = options.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Worker concurrency must be 1–4');
  const running = new Set<Promise<void>>();
  while (!options.stopping()) {
    let claimed = false;
    if (running.size < concurrency) {
      try {
        const job = await options.claim();
        if (job) {
          claimed = true;
          const work = Promise.resolve().then(() => options.process(job)).then(() => {}, options.onError)
            .finally(() => { running.delete(work); });
          running.add(work);
        }
      } catch (error) { options.onError(error); }
    }
    if (claimed && running.size < concurrency) continue;
    // Cancel the idle timer when a running job finishes to avoid accumulating timers.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      ...running,
      new Promise<void>(resolve => { timer = setTimeout(resolve, options.idleMs ?? 1000); }),
    ]);
    if (timer) clearTimeout(timer);
  }
  await Promise.all(running);
}
