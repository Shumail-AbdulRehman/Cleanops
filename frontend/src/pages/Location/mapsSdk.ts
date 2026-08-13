/// <reference types="google.maps" />
export type Coordinates = { lat: number; lng: number };
type MapsWindow = Window & {
  google?: typeof google;
  hygeneMapsReady?: () => void;
  gm_authFailure?: () => void;
};
let loading: Promise<typeof google.maps> | undefined;

export function loadMapsSdk(apiKey: string): Promise<typeof google.maps> {
  const target = window as MapsWindow;
  if (loading) return loading;
  if (target.google?.maps?.places && target.google.maps.marker)
    return Promise.resolve(target.google.maps);
  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let settled = false;
    const previousAuthFailure = target.gm_authFailure;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      delete target.hygeneMapsReady;
      if (error) {
        loading = undefined;
        script.remove();
        target.gm_authFailure = previousAuthFailure;
        reject(error);
      } else if (target.google?.maps) resolve(target.google.maps);
    };
    target.gm_authFailure = () => {
      finish(
        new Error(
          "Google Maps could not authorize this website. You can still enter coordinates manually.",
        ),
      );
      window.dispatchEvent(new Event("hygene:maps-auth-error"));
      previousAuthFailure?.();
    };
    const timeout = setTimeout(
      () =>
        finish(
          new Error(
            "The map took too long to load. Check your connection and try again.",
          ),
        ),
      20000,
    );
    target.hygeneMapsReady = () => finish();
    script.onerror = () =>
      finish(
        new Error(
          "The map could not load. Check your connection or enter coordinates manually.",
        ),
      );
    const params = new URLSearchParams({
      key: apiKey,
      v: "weekly",
      loading: "async",
      libraries: "places,marker",
      callback: "hygeneMapsReady",
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    document.head.appendChild(script);
  });
  return loading;
}

export function parseCoordinates(
  latitude: string,
  longitude: string,
): Coordinates | null {
  if (!latitude.trim() || !longitude.trim()) return null;
  const lat = Number(latitude),
    lng = Number(longitude);
  return Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
    ? { lat, lng }
    : null;
}
