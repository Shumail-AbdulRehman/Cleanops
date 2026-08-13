import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useForm, useWatch } from "react-hook-form";
import {
  Check,
  ChevronDown,
  LocateFixed,
  MapPin,
  Radius,
  LoaderCircle,
} from "lucide-react";
import { SidePanel, SidePanelFooter } from "@/components/workspace/SidePanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocationLanguage } from "./locationTranslations";
import { useCreateLocation, useUpdateLocation } from "./queries";
import { getPreciseCurrentPosition } from "./currentPosition";
import LocationMapPicker from "./LocationMapPicker";
import { parseCoordinates, type Coordinates } from "./mapsSdk";
import type { LocationFormValues } from "./types";
import "./location-form-v6.css";

type EditableLocation = {
  id: number;
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  timezone: string;
  radiusMeters: number;
};
type Props = {
  open: boolean;
  onOpenChange(open: boolean): void;
  onSaved(): void;
  location?: EditableLocation;
};

export default function LocationFormDialog({
  open,
  onOpenChange,
  onSaved,
  location,
}: Props) {
  return open ? (
    <LocationForm
      key={location?.id ?? "new"}
      location={location}
      onOpenChange={onOpenChange}
      onSaved={onSaved}
    />
  ) : null;
}

function LocationForm({
  location,
  onOpenChange,
  onSaved,
}: Omit<Props, "open">) {
  const { t } = useLocationLanguage();
  const formId = useId();
  const create = useCreateLocation(),
    update = useUpdateLocation();
  const mutation = location ? update : create;
  const request = useRef<AbortController | null>(null);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState("");
  const [geoError, setGeoError] = useState("");
  const [timeZones] = useState(() => Intl.supportedValuesOf("timeZone"));
  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<LocationFormValues>({
    defaultValues: {
      name: location?.name ?? "",
      address: location?.address ?? "",
      latitude: location?.latitude ?? "",
      longitude: location?.longitude ?? "",
      timezone: location?.timezone ?? "",
      radiusMeters: location?.radiusMeters ?? 500,
    },
  });
  const [latitude, longitude, radius] = useWatch({
    control,
    name: ["latitude", "longitude", "radiusMeters"],
  });
  const position = parseCoordinates(latitude, longitude);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const submitting = useRef(false);
  const busy = mutation.isPending || pending;
  useEffect(() => {
    const keepMapInteraction = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".gm-style")) event.preventDefault();
    };
    document.addEventListener("dismissableLayer.pointerDownOutside", keepMapInteraction, true);
    document.addEventListener("dismissableLayer.focusOutside", keepMapInteraction, true);
    return () => {
      request.current?.abort();
      document.removeEventListener("dismissableLayer.pointerDownOutside", keepMapInteraction, true);
      document.removeEventListener("dismissableLayer.focusOutside", keepMapInteraction, true);
    };
  }, []);
  function stopLocating() {
    request.current?.abort();
    setLocating(false);
    setGeoError("");
  }
  function select(position: Coordinates, address?: string, name?: string) {
    stopLocating();
    const options = { shouldDirty: true, shouldValidate: true };
    setValue("latitude", position.lat.toFixed(6), options);
    setValue("longitude", position.lng.toFixed(6), options);
    // A moved pin may cross timezones. The server resolves the final saved point.
    setValue("timezone", "", { shouldDirty: true });
    if (address) setValue("address", address, options);
    if (name && !getValues("name").trim()) setValue("name", name, options);
    setNotice(
      address
        ? "Place selected. Adjust the pin if needed."
        : "Pin updated. Check the address before saving.",
    );
  }
  async function locate() {
    stopLocating();
    setNotice("");
    if (!navigator.geolocation) {
      setGeoError("Location access is not supported by this browser.");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setLocating(true);
    try {
      const result = await getPreciseCurrentPosition(
        navigator.geolocation,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      select({ lat: result.coords.latitude, lng: result.coords.longitude });
      setNotice(
        t(
          "Device position selected. Accuracy: {accuracy} m. Check the pin and address.",
          { accuracy: Math.round(result.coords.accuracy) },
        ),
      );
    } catch (error) {
      if (!controller.signal.aborted)
        setGeoError(
          error instanceof Error
            ? error.message
            : "Could not get your location. Choose a point on the map instead.",
        );
    } finally {
      if (request.current === controller) setLocating(false);
    }
  }
  const failure = mutation.error as {
    response?: { status?: number; data?: { errors?: Array<{ code?: string }> } };
  } | undefined;
  const failureCode = failure?.response?.data?.errors?.find(issue => issue.code)?.code;
  const failureMessage = uncertain
    ? "Location creation could not be confirmed. Close and check the location list before creating again."
    : failureCode === "CAPACITY_REACHED"
      ? "Your plan’s location capacity has been reached. Review Plan & billing. Your draft is kept."
      : failureCode === "SUBSCRIPTION_REQUIRED"
        ? "An active subscription is required to add locations. Review Plan & billing. Your draft is kept."
        : failure?.response?.status === 403
          ? "You do not have access to this action. Refresh your workspace before trying again."
          : "Location could not be saved. Check the details and try again. Your draft is kept.";
  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (submitting.current || uncertain) {
      event.preventDefault();
      return;
    }
    submitting.current = true;
    void handleSubmit(async data => {
      setPending(true);
      stopLocating();
      const payload = { ...data, timezone: data.timezone || undefined };
      try {
        if (location) await update.mutateAsync({ id: location.id, data: payload });
        else await create.mutateAsync(payload);
        onSaved();
      } catch (error) {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (!location && (!status || status >= 500)) setUncertain(true);
      } finally {
        submitting.current = false;
        setPending(false);
      }
    }, () => { submitting.current = false; })(event);
  };
  const footer = (
    <div className="wx-location-editor-footer">
      <div className="wx-location-footer-message">
        {mutation.isError || uncertain ? (
          <p role="alert" className="wx-location-field-error">
            {t(failureMessage)}
          </p>
        ) : (
          <p>
            {t(
              location
                ? "Changes apply to future attendance checks."
                : "Next, add areas and assign your team.",
            )}
          </p>
        )}
      </div>
      <SidePanelFooter className="wx-location-footer-actions">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => onOpenChange(false)}
        >
          {t("Cancel")}
        </Button>
        <Button type="submit" form={formId} disabled={busy || locating || uncertain}>
          {busy ? (
            <LoaderCircle size={16} className="animate-spin" />
          ) : (
            <Check size={16} />
          )}{" "}
          {t(
            busy
              ? "Saving..."
              : location
                ? "Save changes"
                : "Create location",
          )}
        </Button>
      </SidePanelFooter>
    </div>
  );
  return (
    <SidePanel
      open
      wide
      title={location ? "Edit location" : "Add location"}
      description="Find your site and set where your team can check in."
      onOpenChange={next => {
        if (!submitting.current && !busy) onOpenChange(next);
      }}
      footer={footer}
    >
      <form id={formId} onSubmit={submit} noValidate className="wx-location-editor" aria-busy={busy}>
        <div className="wx-location-editor-body">
          <div className="wx-location-editor-map">
            <LocationMapPicker
              latitude={latitude}
              longitude={longitude}
              radius={radius}
              disabled={busy || locating}
              onSelect={select}
            />
            <div className="wx-location-current-position">
              <div>
                <strong>{t("Already at the site?")}</strong>
                <p>{t("Use your device position, then adjust the pin.")}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={busy || locating}
                onClick={() => void locate()}
              >
                {locating ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <LocateFixed size={16} />
                )}{" "}
                {t(locating ? "Locating..." : "Use my position")}
              </Button>
            </div>
            {geoError ? (
              <p role="alert" className="wx-location-field-error">
                {t(geoError)}
              </p>
            ) : null}
            {notice ? (
              <p className="wx-location-selection-notice" role="status">
                <Check size={16} />
                {t(notice)}
              </p>
            ) : null}
          </div>
          <div className="wx-location-editor-details">
            <h3 className="wx-location-section-label">{t("Location details")}</h3>
            <div className="wx-location-field">
              <label htmlFor="location-name">{t("Location name")}</label>
              <Input
                id="location-name"
                placeholder={t("e.g. Blue Area Office")}
                disabled={busy}
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? "location-name-error" : "location-name-note"}
                {...register("name", {
                  required: "Name is required",
                  validate: (v) => !!v.trim() || "Name is required",
                  maxLength: { value: 200, message: "Name must be 200 characters or fewer." },
                })}
              />
              <p id="location-name-note" className="wx-location-field-note">
                {t("Give this site a name your team will recognise.")}
              </p>
              {errors.name ? (
                <p
                  id="location-name-error"
                  role="alert"
                  className="wx-location-field-error"
                >
                  {t(errors.name.message ?? "Name is required")}
                </p>
              ) : null}
            </div>
            <div className="wx-location-field">
              <label htmlFor="location-address">{t("Street address")}</label>
              <Input
                id="location-address"
                placeholder={t("Building, street, city")}
                disabled={busy}
                aria-invalid={!!errors.address}
                aria-describedby={
                  errors.address
                    ? "location-address-error"
                    : "location-address-note"
                }
                {...register("address", {
                  required: "Address is required",
                  validate: (v) => !!v.trim() || "Address is required",
                  maxLength: { value: 1000, message: "Address must be 1,000 characters or fewer." },
                })}
              />
              <p id="location-address-note" className="wx-location-field-note">
                {t("Filled from search. Add a floor or entrance if helpful.")}
              </p>
              {errors.address ? (
                <p
                  id="location-address-error"
                  role="alert"
                  className="wx-location-field-error"
                >
                  {t(errors.address.message ?? "Address is required")}
                </p>
              ) : null}
            </div>
            <div className="wx-location-radius-setting">
              <div className="wx-location-radius-heading">
                <label htmlFor="location-radius">
                  <Radius size={17} />
                  {t("Attendance radius")}
                </label>
                <span>{t("metres")}</span>
              </div>
              <div className="wx-location-radius-controls">
                <Input
                  id="location-radius"
                  type="number"
                  min={25}
                  max={5000}
                  step={1}
                  disabled={busy}
                  aria-invalid={!!errors.radiusMeters}
                  aria-describedby={errors.radiusMeters ? "location-radius-note location-radius-error" : "location-radius-note"}
                  {...register("radiusMeters", {
                    valueAsNumber: true,
                    required: "Enter an attendance radius",
                    min: {
                      value: 25,
                      message: "Choose a radius between 25 and 5,000 m",
                    },
                    max: {
                      value: 5000,
                      message: "Choose a radius between 25 and 5,000 m",
                    },
                    validate: (v) =>
                      Number.isInteger(v) || "Use a whole number of metres",
                  })}
                />
                <div
                  className="wx-location-radius-presets"
                  role="group"
                  aria-label={t("Suggested attendance radii")}
                >
                  {[50, 100, 250, 500].map((value) => (
                    <button
                      key={value}
                      type="button"
                      disabled={busy}
                      aria-pressed={radius === value}
                      onClick={() =>
                        setValue("radiusMeters", value, {
                          shouldValidate: true,
                          shouldDirty: true,
                        })
                      }
                    >
                      {t("{radius} m", { radius: value })}
                    </button>
                  ))}
                </div>
              </div>
              <p id="location-radius-note" className="wx-location-field-note">
                {t(
                  "Staff must be inside this circle to check in. Choose a boundary that covers the work site.",
                )}
              </p>
              {errors.radiusMeters ? (
                <p id="location-radius-error" role="alert" className="wx-location-field-error">
                  {t(errors.radiusMeters.message ?? "Enter an attendance radius")}
                </p>
              ) : null}
            </div>
            <details
              className="wx-location-coordinate-details"
              open={!!errors.latitude || !!errors.longitude || undefined}
            >
              <summary>
                {t("Coordinates & timezone")}
                <ChevronDown size={16} />
              </summary>
              <div className="wx-location-coordinate-grid">
                {(["latitude", "longitude"] as const).map((field) => (
                  <div className="wx-location-field" key={field}>
                    <label htmlFor={`location-${field}`}>
                      {t(field === "latitude" ? "Latitude" : "Longitude")}
                    </label>
                    <Input
                      id={`location-${field}`}
                      dir="ltr"
                      type="number"
                      step="any"
                      disabled={busy}
                      aria-invalid={!!errors[field]}
                      aria-describedby={errors[field] ? `location-${field}-error` : undefined}
                      {...register(field, {
                        required:
                          "Choose a location on the map or enter coordinates",
                        validate: (value) =>
                          (value.trim() !== "" &&
                            Number.isFinite(Number(value)) &&
                            Math.abs(Number(value)) <=
                              (field === "latitude" ? 90 : 180)) ||
                          "Enter valid coordinates",
                        onChange: () => {
                          stopLocating();
                          setNotice("");
                          setValue("timezone", "", { shouldDirty: true });
                        },
                      })}
                    />
                    {errors[field] ? (
                      <p id={`location-${field}-error`} role="alert" className="wx-location-field-error">
                        {t(errors[field]?.message ?? "Enter valid coordinates")}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="wx-location-field">
                <label htmlFor="location-timezone">{t("Timezone")}</label>
                <select
                  id="location-timezone"
                  disabled={busy}
                  {...register("timezone")}
                >
                  <option value="">{t("Auto-detect from coordinates")}</option>
                  {timeZones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
                <p className="wx-location-field-note">
                  {t("Used for shifts, schedules and attendance times.")}
                </p>
              </div>
            </details>
            <div
              className={`wx-location-position-status ${position ? "is-selected" : ""}`}
            >
              <MapPin size={17} />
              <span>
                <strong>
                  {t(
                    position
                      ? "Site position selected"
                      : "Choose your site position",
                  )}
                </strong>
                <small dir={position ? "ltr" : undefined}>
                  {position
                    ? `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`
                    : t("Search, click the map or enter coordinates.")}
                </small>
              </span>
            </div>
          </div>
        </div>
      </form>
    </SidePanel>
  );
}
