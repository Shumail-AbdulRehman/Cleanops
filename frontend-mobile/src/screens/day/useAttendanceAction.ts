import { useEffect, useRef, useState } from "react";
import { useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { useQueryClient } from "@tanstack/react-query";
import { readAttendance } from "../../launch/launchApi";
import {
  attendanceResult,
  reconcileAttendance,
  type AttendanceAction,
} from "../../launch/recoveryPolicy";
import { uploadFormData } from "../../api/client";
import { staffQueryKeys } from "../../queries/staff";
import type { AttendanceRecord } from "../../types";
import { getRelevantAttendanceRecord } from "../../utils/attendance";
import { createImagePart } from "../../utils/upload";
import { currentLocation } from "../../verification/location";

/**
 * Check-in and check-out, moved from `HomeScreen.tsx` (`handleAttendanceAction`
 * and `submitAttendanceSelfie`) with the same calls in the same order. Each
 * Alert or notice of the old screen is now a phase the new screens draw.
 *
 * `error` holds an English key or the server's message: render it through
 * `t()` (StaffText does this for plain string children).
 */
export type AttendanceActionMode = AttendanceAction;

export type AttendanceActionPhase =
  | "idle"
  | "checkingServer"
  | "needsPermission"
  | "locating"
  | "weakSignal"
  /**
   * Reserved. The server reports a geofence rejection only as a 400 with a
   * message and no error code (`attendanceWrites.service.ts`), so the hook
   * cannot tell it apart reliably and shows it as `error` with that message.
   */
  | "notAtLocation"
  | "selfie"
  | "saving"
  | "done"
  | "error";

export type AttendanceActionResult = {
  mode: AttendanceActionMode;
  /** Server time of the recorded check-in or check-out. */
  at: string | null;
  /** The shift was checked in late (server status `LATE`). */
  late: boolean;
};

export type UseAttendanceActionInput = {
  staffId: number | undefined;
  records: AttendanceRecord[];
  now: Date;
  online: boolean;
};

/** Same threshold as the old "Low location accuracy" prompt. */
export const WEAK_SIGNAL_METERS = 50;

type Position = Awaited<ReturnType<typeof currentLocation>>;
type Capture = { mode: AttendanceActionMode; expected: AttendanceRecord; coords: Position };
type View = {
  phase: AttendanceActionPhase;
  mode: AttendanceActionMode | null;
  result: AttendanceActionResult | null;
  error: string | null;
  accuracyMeters: number | null;
};

const IDLE: View = { phase: "idle", mode: null, result: null, error: null, accuracyMeters: null };
/** A flow is in progress: a new `start` is ignored until it ends or is cancelled. */
const BUSY: ReadonlySet<AttendanceActionPhase> = new Set([
  "checkingServer", "locating", "weakSignal", "selfie", "saving",
]);

export function attendanceErrorMessage(error: any, fallback: string) {
  return error?.code === "ERR_NETWORK"
    ? "Internet needed to continue"
    : (error?.response?.data?.message ?? error?.message ?? fallback);
}

function resultFor(mode: AttendanceActionMode, record: AttendanceRecord): AttendanceActionResult {
  return {
    mode,
    at: mode === "check-in" ? record.checkInTime : record.checkOutTime,
    late: record.status === "LATE",
  };
}

export function useAttendanceAction({ staffId, records, now, online }: UseAttendanceActionInput) {
  const queryClient = useQueryClient();
  const [, requestCameraPermission] = useCameraPermissions();
  const [view, setView] = useState<View>(IDLE);
  const phaseRef = useRef<AttendanceActionPhase>("idle");
  const runRef = useRef(0);
  const captureRef = useRef<Capture | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runRef.current += 1;
    };
  }, []);

  const update = (next: View) => {
    phaseRef.current = next.phase;
    if (mountedRef.current) setView(next);
  };
  const current = (run: number) => mountedRef.current && run === runRef.current;
  const fail = (run: number, mode: AttendanceActionMode, error: unknown, fallback: string) => {
    if (current(run)) update({ ...IDLE, phase: "error", mode, error: attendanceErrorMessage(error, fallback) });
  };

  const locate = async (run: number, mode: AttendanceActionMode, expected: AttendanceRecord) => {
    update({ ...IDLE, phase: "locating", mode });
    // Get a fresh, high-accuracy location BEFORE opening the camera.
    // Indoor GPS can be inaccurate; Highest accuracy reduces the chance
    // that a staff member is rejected while standing at the correct location.
    const coords = await currentLocation((next, failure) =>
      Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Highest,
          timeInterval: 1000,
          distanceInterval: 0,
        },
        next,
        failure,
      ),
    );
    if (!current(run)) return;
    captureRef.current = { mode, expected, coords };
    const accuracyMeters = coords.coords.accuracy ?? 0;
    update({
      ...IDLE,
      phase: accuracyMeters > WEAK_SIGNAL_METERS ? "weakSignal" : "selfie",
      mode,
      accuracyMeters,
    });
  };

  const start = async (mode: AttendanceActionMode) => {
    if (BUSY.has(phaseRef.current)) return;
    const run = ++runRef.current;
    captureRef.current = null;
    if (!online) {
      update({ ...IDLE, phase: "error", mode, error: "Internet needed to continue" });
      return;
    }
    update({ ...IDLE, phase: "checkingServer", mode });
    try {
      const expected = getRelevantAttendanceRecord(records, now);
      if (!expected) throw new Error("Refresh to load your shift before continuing.");
      const refreshed = await readAttendance();
      const latest = attendanceResult(refreshed, expected, mode);
      queryClient.setQueryData(staffQueryKeys.attendance(staffId), refreshed);
      if (!current(run)) return;
      if (latest.recorded) {
        update({ ...IDLE, phase: "done", mode, result: resultFor(mode, latest.record) });
        return;
      }

      const cameraPermission = await requestCameraPermission();
      if (!current(run)) return;
      if (!cameraPermission.granted) {
        update({ ...IDLE, phase: "needsPermission", mode, error: "Allow camera access to capture an attendance image." });
        return;
      }

      const locationPermission = await Location.requestForegroundPermissionsAsync();
      if (!current(run)) return;
      if (!locationPermission.granted) {
        update({ ...IDLE, phase: "needsPermission", mode, error: "Allow location access to mark attendance." });
        return;
      }

      await locate(run, mode, expected);
    } catch (error) {
      fail(run, mode, error, "Unable to open attendance.");
    }
  };

  /** Weak signal: look for a better fix again (permissions are already granted). */
  const retryLocation = async () => {
    const capture = captureRef.current;
    if (phaseRef.current !== "weakSignal" || !capture) return;
    const run = runRef.current;
    try {
      await locate(run, capture.mode, capture.expected);
    } catch (error) {
      fail(run, capture.mode, error, "Unable to open attendance.");
    }
  };

  /** Weak signal: open the camera with the fix already found. */
  const continueAnyway = () => {
    const capture = captureRef.current;
    if (phaseRef.current !== "weakSignal" || !capture) return;
    update({ ...IDLE, phase: "selfie", mode: capture.mode, accuracyMeters: capture.coords.coords.accuracy ?? 0 });
  };

  /** Back to idle. Ignored while saving: the upload's server result must still be shown. */
  const cancel = () => {
    if (phaseRef.current === "saving") return;
    runRef.current += 1;
    captureRef.current = null;
    update(IDLE);
  };

  const submitSelfie = async (uri: string) => {
    const capture = captureRef.current;
    if (phaseRef.current !== "selfie" || !capture) return;
    const run = runRef.current;
    const { mode, coords, expected } = capture;
    update({ ...IDLE, phase: "saving", mode, accuracyMeters: coords.coords.accuracy ?? 0 });
    try {
      const formData = new FormData();
      formData.append("latitude", String(coords.coords.latitude));
      formData.append("longitude", String(coords.coords.longitude));
      formData.append("accuracy", String(coords.coords.accuracy ?? 0));
      formData.append(
        "image",
        createImagePart(uri, `${mode}.jpg`, "image/jpeg"),
      );

      if (mode === "check-out") formData.append("attendanceId", String(expected.id));
      const record = await reconcileAttendance(readAttendance, () => uploadFormData(`/attendance/${mode}`, formData, 60000), expected, mode);
      captureRef.current = null;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: staffQueryKeys.attendance(staffId),
        }),
        queryClient.invalidateQueries({
          queryKey: staffQueryKeys.tasksToday(staffId),
        }),
      ]);
      if (current(run)) update({ ...IDLE, phase: "done", mode, result: resultFor(mode, record) });
    } catch (error) {
      captureRef.current = null;
      fail(run, mode, error, `Unable to ${mode.replace("-", " ")}.`);
    }
  };

  return {
    phase: view.phase,
    mode: view.mode,
    result: view.result,
    error: view.error,
    accuracyMeters: view.accuracyMeters,
    start,
    retryLocation,
    continueAnyway,
    cancel,
    submitSelfie,
  };
}
