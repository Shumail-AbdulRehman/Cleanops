type PendingLogout = { server: string; refreshToken: string };
type Store = {
  read: () => Promise<string | null>;
  write: (value: string | null) => Promise<void>;
};
// Persist only logout revocations, never photo uploads. Entries remain encrypted
// in SecureStore and are retried after connectivity returns, even when signed out.
export function createLogoutQueue(
  store: Store,
  post: (entry: PendingLogout) => Promise<void>,
) {
  let operations = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>) => {
    const next = operations.then(operation);
    operations = next.then(
      () => {},
      () => {},
    );
    return next;
  };
  const load = async () => {
    try {
      return JSON.parse((await store.read()) ?? "[]") as PendingLogout[];
    } catch {
      return [];
    }
  };
  return {
    enqueue: (entry: PendingLogout) =>
      serial(async () => {
        const entries = await load();
        if (
          !entries.some(
            (e) =>
              e.server === entry.server &&
              e.refreshToken === entry.refreshToken,
          )
        )
          entries.push(entry);
        await store.write(JSON.stringify(entries));
      }),
    flush: () =>
      serial(async () => {
        const entries = await load(),
          remaining: PendingLogout[] = [];
        for (const entry of entries) {
          try {
            await post(entry);
          } catch {
            remaining.push(entry);
          }
        }
        await store.write(remaining.length ? JSON.stringify(remaining) : null);
      }),
  };
}
