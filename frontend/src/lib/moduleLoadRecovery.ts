const recoveryKey = 'hygene-ops.module-recovery-at';
const cooldownMs = 60_000;
const importFailure = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading chunk .+ failed/i;

// A tab opened before a deploy can still refer to removed, hashed Vite chunks.
// Persist the attempt before reloading so a broken deploy cannot cause a loop.
export function installModuleLoadRecovery(
  target: Window = window,
  reload: () => void = () => target.location.reload(),
) {
  let attempted = false;
  const recover = (event: Event) => {
    const payload = (event as Event & { payload?: unknown }).payload;
    const message = payload instanceof Error ? payload.message : String(payload ?? '');
    if (attempted || !target.navigator.onLine || !importFailure.test(message)) return;
    try {
      const now = Date.now();
      const previous = Number(target.sessionStorage.getItem(recoveryKey));
      if (Number.isFinite(previous) && previous > 0 && now - previous < cooldownMs) return;
      target.sessionStorage.setItem(recoveryKey, String(now));
    } catch {
      // Without storage we cannot bound attempts across page loads.
      return;
    }
    attempted = true;
    event.preventDefault();
    reload();
  };
  target.addEventListener('vite:preloadError', recover);
  return () => target.removeEventListener('vite:preloadError', recover);
}
