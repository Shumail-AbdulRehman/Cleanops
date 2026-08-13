export const LOCATION_ACCURACY_LIMIT_METERS = 50;

const formatAccuracy = (meters: number) =>
  meters >= 1000
    ? `${(meters / 1000).toFixed(1)} km`
    : `${Math.round(meters)} m`;

/** Wait for a usable reading rather than accepting the first network estimate. */
export function getPreciseCurrentPosition(
  geolocation: Geolocation,
  signal: AbortSignal,
  timeoutMs = 15000,
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    let watchId: number | undefined;
    let finished = false;
    let bestAccuracy = Infinity;

    const finish = (position?: GeolocationPosition, error?: Error) => {
      if (finished) return;
      finished = true;
      if (watchId !== undefined) geolocation.clearWatch(watchId);
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (position) resolve(position);
      else reject(error);
    };
    const abort = () =>
      finish(undefined, new DOMException("Cancelled", "AbortError"));
    const timeout = () =>
      finish(
        undefined,
        new Error(
          Number.isFinite(bestAccuracy)
            ? `Your device could only estimate your location within ±${formatAccuracy(bestAccuracy)}. Coordinates were not filled in. Enter the site's coordinates manually, or try a GPS-enabled device at the site (50 m accuracy or better).`
            : "Could not get an accurate location. Coordinates were not filled in. Enter the site's coordinates manually or try again at the site.",
        ),
      );

    const timer = setTimeout(timeout, timeoutMs);
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    try {
      watchId = geolocation.watchPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          if (
            finished ||
            !Number.isFinite(latitude) ||
            Math.abs(latitude) > 90 ||
            !Number.isFinite(longitude) ||
            Math.abs(longitude) > 180 ||
            !Number.isFinite(accuracy) ||
            accuracy < 0
          )
            return;
          bestAccuracy = Math.min(bestAccuracy, accuracy);
          if (accuracy <= LOCATION_ACCURACY_LIMIT_METERS) finish(position);
        },
        (error) => {
          if (error.code === 1)
            finish(
              undefined,
              new Error(
                "Location permission was denied. Allow location access in your browser, or enter the site's coordinates manually.",
              ),
            );
          // A transient unavailable/timeout error may be followed by a better fix.
        },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
      );
      if (finished) geolocation.clearWatch(watchId);
    } catch {
      finish(
        undefined,
        new Error(
          "Location access is unavailable. Enter the site's coordinates manually.",
        ),
      );
    }
  });
}
