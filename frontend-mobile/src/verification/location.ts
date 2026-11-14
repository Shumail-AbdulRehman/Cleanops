type Position = { coords: { latitude: number; longitude: number; accuracy: number | null }; timestamp: number };
type Subscription = { remove(): void };

/** One bounded, cancellable native watch; never substitutes an old location. */
export function currentLocation(
  subscribe: (next: (position: Position) => void, error: (reason: string) => void) => Promise<Subscription>,
  timeoutMs = 20_000,
): Promise<Position> {
  return new Promise((resolve, reject) => {
    let subscription: Subscription | undefined;
    let best: Position | undefined;
    let finished = false;
    const finish = (position?: Position, error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      subscription?.remove();
      if (position) resolve(position); else reject(error);
    };
    const fresh = (position: Position) => Number.isFinite(position.coords.latitude) &&
      Number.isFinite(position.coords.longitude) && Date.now() - position.timestamp <= 30_000 &&
      position.timestamp <= Date.now() + 5000;
    const timer = setTimeout(() => {
      if (best && fresh(best)) finish(best);
      else finish(undefined, new Error('Location could not be found in 20 seconds. Turn on precise location, move near the doorway, then try again.'));
    }, timeoutMs);
    void subscribe(position => {
      if (finished || !fresh(position)) return;
      if (!best || (position.coords.accuracy ?? Infinity) < (best.coords.accuracy ?? Infinity)) best = position;
      if ((position.coords.accuracy ?? Infinity) <= 50) finish(position);
    }, () => finish(undefined, new Error('Location is unavailable. Check that precise location is on, then try again.')))
      .then(value => { subscription = value; if (finished) value.remove(); })
      .catch(() => finish(undefined, new Error('Location could not start. Enable location services and try again.')));
  });
}
