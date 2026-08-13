import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  Crosshair,
  MapPin,
  MapPinned,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/i18n/context";
import "./location-form-v6.css";
import { getLocationMapConfig } from "./api";
import { loadMapsSdk, parseCoordinates, type Coordinates } from "./mapsSdk";

type Props = {
  latitude: string;
  longitude: string;
  radius: number;
  disabled: boolean;
  onSelect(position: Coordinates, address?: string, name?: string): void;
};
const DEFAULT_CENTER = { lat: 30.3753, lng: 69.3451 };

export default function LocationMapPicker({
  latitude,
  longitude,
  radius,
  disabled,
  onSelect,
}: Props) {
  const { t } = useLanguage();
  const id = useId();
  const config = useQuery({
    queryKey: ["location-map-config"],
    queryFn: getLocationMapConfig,
    staleTime: Infinity,
    retry: 1,
  });
  const canvas = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const marker = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const circle = useRef<google.maps.Circle | null>(null);
  const callback = useRef(onSelect);
  const disabledRef = useRef(disabled);
  useEffect(() => {
    callback.current = onSelect;
    disabledRef.current = disabled;
  }, [onSelect, disabled]);
  const initial = useRef({ latitude, longitude, radius });
  const hadPosition = useRef(Boolean(parseCoordinates(latitude, longitude)));
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [predictions, setPredictions] = useState<
    google.maps.places.PlacePrediction[]
  >([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [active, setActive] = useState(-1);
  const [focused, setFocused] = useState(false);
  const session = useRef<google.maps.places.AutocompleteSessionToken | null>(
    null,
  );
  const searchVersion = useRef(0);
  const detailVersion = useRef(0);
  const selected = parseCoordinates(latitude, longitude);
  const searchOpen = useRef(false);
  useLayoutEffect(() => {
    searchOpen.current = focused && predictions.length > 0;
  }, [focused, predictions.length]);
  useLayoutEffect(() => {
    // Radix listens at document capture. Let the first Escape close suggestions
    // before it can dismiss the whole form and discard its draft.
    const escapeSearch = (event: KeyboardEvent) => {
      if (event.key === "Escape" && searchOpen.current &&
          event.target instanceof Element && event.target.id === id) event.preventDefault();
    };
    document.addEventListener("keydown", escapeSearch, true);
    return () => document.removeEventListener("keydown", escapeSearch, true);
  }, [id]);


  useEffect(() => {
    if (!config.data?.enabled || !config.data.apiKey || !canvas.current) return;
    let live = true;
    const versions = { search: searchVersion, detail: detailVersion };
    const listeners: google.maps.MapsEventListener[] = [];
    const authFailure = () => {
      if (live) {
        setReady(false);
        setError(
          "Google Maps could not authorize this website. You can still enter coordinates manually.",
        );
      }
    };
    window.addEventListener("hygene:maps-auth-error", authFailure);
    void loadMapsSdk(config.data.apiKey)
      .then((maps) => {
        if (!live || !canvas.current) return;
        const position = parseCoordinates(
          initial.current.latitude,
          initial.current.longitude,
        );
        const instance = new maps.Map(canvas.current, {
          center: position ?? DEFAULT_CENTER,
          zoom: position ? 16 : 5,
          mapId: config.data.mapId,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: "cooperative",
          zoomControl: true,
          cameraControl: false,
        });
        const theme = getComputedStyle(canvas.current);
        const color = (token: string) => theme.getPropertyValue(token).trim();
        const pin = new maps.marker.PinElement({
          background: color("--wx-ink"),
          borderColor: color("--wx-ink"),
          glyphColor: color("--wx-surface"),
          scale: 1.15,
        });
        const point = new maps.marker.AdvancedMarkerElement({
          map: instance,
          position,
          gmpDraggable: true,
          title: t("Drag to the exact work location"),
          content: pin.element,
        });
        const boundary = new maps.Circle({
          map: instance,
          center: position ?? DEFAULT_CENTER,
          radius: initial.current.radius,
          visible: Boolean(position),
          clickable: false,
          fillColor: color("--wx-blue"),
          fillOpacity: 0.12,
          strokeColor: color("--wx-blue"),
          strokeOpacity: 0.8,
          strokeWeight: 1.5,
        });
        map.current = instance;
        marker.current = point;
        circle.current = boundary;
        listeners.push(
          instance.addListener("click", (event: google.maps.MapMouseEvent) => {
            if (!disabledRef.current && event.latLng)
              callback.current(event.latLng.toJSON());
          }),
        );
        listeners.push(
          point.addListener("dragend", () => {
            if (disabledRef.current || !point.position) return;
            const p = point.position;
            callback.current({
              lat: typeof p.lat === "function" ? p.lat() : p.lat,
              lng: typeof p.lng === "function" ? p.lng() : p.lng,
            });
          }),
        );
        setReady(true);
      })
      .catch(() => {
        if (live)
          setError(
            "The map could not load. Check your connection or enter coordinates manually.",
          );
      });
    return () => {
      live = false;
      versions.search.current++;
      versions.detail.current++;
      window.removeEventListener("hygene:maps-auth-error", authFailure);
      listeners.forEach((listener) => listener.remove());
      if (marker.current) marker.current.map = null;
      circle.current?.setMap(null);
      map.current = null;
      marker.current = null;
      circle.current = null;
    };
  }, [config.data, attempt, t]);

  useEffect(() => {
    const position = parseCoordinates(latitude, longitude);
    if (!ready || !marker.current || !map.current || !circle.current) return;
    marker.current.position = position;
    marker.current.gmpDraggable = !disabled;
    circle.current.setVisible(Boolean(position));
    circle.current.setRadius(Number.isFinite(radius) ? radius : 500);
    if (position) {
      if (!hadPosition.current) map.current.setZoom(16);
      map.current.panTo(position);
      circle.current.setCenter(position);
    }
    hadPosition.current = Boolean(position);
  }, [latitude, longitude, radius, disabled, ready]);

  useEffect(() => {
    const version = ++searchVersion.current;
    if (!ready || !focused || query.trim().length < 2) return;
    let live = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError("");
      try {
        session.current ??= new google.maps.places.AutocompleteSessionToken();
        const center = map.current?.getCenter();
        const result =
          await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(
            {
              input: query.trim(),
              sessionToken: session.current,
              ...(center ? { locationBias: { center, radius: 50000 } } : {}),
              region: "pk",
            },
          );
        if (live && version === searchVersion.current) {
          setPredictions(
            result.suggestions.flatMap((s) =>
              s.placePrediction ? [s.placePrediction] : [],
            ),
          );
          setActive(-1);
          if (!result.suggestions.length)
            setSearchError(
              "No places found. Try another address or choose a point on the map.",
            );
        }
      } catch {
        if (live && version === searchVersion.current) {
          setPredictions([]);
          setSearchError(
            "Place search is unavailable. You can still select a point on the map.",
          );
        }
      } finally {
        if (live && version === searchVersion.current) setSearching(false);
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, ready, focused]);

  async function choose(prediction: google.maps.places.PlacePrediction) {
    searchVersion.current++;
    const version = ++detailVersion.current;
    setPredictions([]);
    setFocused(false);
    setSearching(true);
    setSearchError("");
    try {
      const place = prediction.toPlace();
      await place.fetchFields({
        fields: ["location", "formattedAddress", "displayName"],
      });
      if (version !== detailVersion.current || disabledRef.current) return;
      if (!place.location) throw new Error("No coordinates");
      callback.current(
        place.location.toJSON(),
        place.formattedAddress ?? undefined,
        place.displayName ?? undefined,
      );
      map.current?.setZoom(17);
      setQuery(place.formattedAddress ?? prediction.text.toString());
    } catch {
      if (version === detailVersion.current)
        setSearchError(
          "This place could not be selected. Try again or choose a point on the map.",
        );
    } finally {
      if (version === detailVersion.current) {
        session.current = null;
        setSearching(false);
      }
    }
  }
  const unavailable =
    config.isError || config.data?.enabled === false || Boolean(error);
  return (
    <section
      className="wx-location-map-picker"
      aria-label={t("Choose the work location")}
    >
      <div className="wx-location-place-search">
        <label htmlFor={id}>{t("Search for a place or address")}</label>
        <div className="wx-location-search-input">
          <Search size={18} aria-hidden="true" />
          <Input
            id={id}
            role="combobox"
            aria-autocomplete="list"
            aria-busy={searching}
            aria-expanded={focused && predictions.length > 0}
            aria-controls={focused && predictions.length > 0 ? `${id}-results` : undefined}
            aria-activedescendant={focused && predictions[active] ? `${id}-${active}` : undefined}
            placeholder={t("Search a building, business or street")}
            value={query}
            disabled={!ready || disabled}
            autoComplete="off"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(event) => {
              detailVersion.current++;
              setQuery(event.target.value);
              setPredictions([]);
              setActive(-1);
              setSearching(false);
              setFocused(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setActive((previous) =>
                  event.key === "ArrowDown"
                    ? Math.min(previous + 1, predictions.length - 1)
                    : Math.max(previous - 1, 0),
                );
              }
              if (event.key === "Enter") {
                event.preventDefault();
                if (predictions[active >= 0 ? active : 0])
                  void choose(predictions[active >= 0 ? active : 0]);
              }
              if (event.key === "Escape" && predictions.length) {
                event.preventDefault();
                event.stopPropagation();
                setPredictions([]);
              }
            }}
          />
          {searching ? (
            <span className="wx-location-search-status" role="status">{t("Searching places")}</span>
          ) : query ? (
            <button
              type="button"
              disabled={disabled}
              aria-label={t("Clear search")}
              onClick={() => {
                searchVersion.current++;
                detailVersion.current++;
                setQuery("");
                setPredictions([]);
                setSearchError("");
                setSearching(false);
              }}
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
        {focused && predictions.length > 0 ? (
          <ul
            id={`${id}-results`}
            className="wx-location-place-results"
            role="listbox"
            aria-label={t("Suggested places")}
          >
            {predictions.map((p, index) => (
              <li
                id={`${id}-${index}`}
                key={p.placeId}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void choose(p)}
              >
                <MapPin size={18} aria-hidden="true" />
                <span>
                  <strong>{p.mainText?.toString() ?? p.text.toString()}</strong>
                  <small>{p.secondaryText?.toString()}</small>
                </span>
                {index === active ? <Check size={16} /> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {searchError ? (
          <p className="wx-location-field-note" role="status">
            {t(searchError)}
          </p>
        ) : null}
      </div>
      <div className="wx-location-map-frame">
        <div
          ref={canvas}
          className="wx-location-map-canvas"
          aria-label={t("Location map")}
        />
        {!ready || unavailable ? (
          <div className="wx-location-map-placeholder" role="status">
            {unavailable ? (
              <MapPinned size={32} />
            ) : (
              <span className="wx-location-map-skeleton" aria-hidden="true" />
            )}
            <strong>
              {t(unavailable ? "Map unavailable" : "Loading your map")}
            </strong>
            <p>
              {t(
                error ||
                  (config.data?.enabled === false
                    ? "The map is not configured yet. You can enter coordinates below."
                    : config.isError
                      ? "Could not connect to the map. Try again or enter coordinates below."
                      : "Find the site, then fine-tune its position."),
              )}
            </p>
            {unavailable && config.data?.enabled !== false ? (
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                onClick={() => {
                  setError("");
                  setReady(false);
                  setAttempt((n) => n + 1);
                  if (config.isError) void config.refetch();
                }}
              >
                {t("Retry map")}
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <span className="wx-location-map-hint" aria-live="polite">
              <MapPin size={14} />
              {t(
                selected
                  ? "Drag the pin to fine-tune"
                  : "Click the map to place your pin",
              )}
            </span>
            <Button
              className="wx-location-center-button"
              variant="outline"
              size="icon"
              type="button"
              aria-label={t("Use map center")}
              title={t("Use map center")}
              disabled={disabled}
              onClick={() => {
                const p = map.current?.getCenter();
                if (p) {
                  callback.current(p.toJSON());
                  map.current?.setZoom(17);
                }
              }}
            >
              <Crosshair size={19} />
            </Button>
          </>
        )}
      </div>
      <div className="wx-location-map-caption">
        <span className="wx-location-radius-dot" aria-hidden="true" />
        <span>{t("Shaded circle: attendance check-in area")}</span>
        <strong>{t("{radius} m", { radius: Number.isFinite(radius) ? radius : 500 })}</strong>
      </div>
    </section>
  );
}
