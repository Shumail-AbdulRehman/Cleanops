import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { Camera, ZoomIn, ZoomOut } from "lucide-react";
import { client } from "@/api/client";
import useAuth from "@/hooks/useAuth";
import { useLanguage } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import "@/pages/Attendance/attendance-panel-v6.css";

export type AttendancePhoto = {
  state: "AVAILABLE" | "NONE" | "LEGACY_RESTRICTED";
  path: string | null;
};
export type ProtectedAttendancePhotoProps = {
  attendanceId: number;
  kind: "check-in" | "check-out";
  photo?: AttendancePhoto | null;
  /** Mount a tile only inside an open record: it requests protected bytes on mount. */
  presentation?: "button" | "tile";
  /** Used only when no photo exists; available protected photos keep their access checks. */
  missingMessage?: string;
};
type PhotoState = { kind: "loading" } | { kind: "ready"; url: string } | { kind: "failed"; status?: number };

function PhotoBytes({ path, alt, retry, tileKind }: { path: string; alt: string; retry: () => void; tileKind?: ProtectedAttendancePhotoProps["kind"] }) {
  const { t } = useLanguage();
  const [state, setState] = useState<PhotoState>({ kind: "loading" });
  useEffect(() => {
    const abort = new AbortController();
    let url: string | undefined;
    client.get<Blob>(path, { responseType: "blob", signal: abort.signal })
      .then(({ data }) => {
        if (abort.signal.aborted) return;
        if (!data.type.startsWith("image/jpeg") || !data.size || data.size > 5 * 1024 * 1024)
          throw new Error("Invalid photo response");
        url = URL.createObjectURL(data);
        setState({ kind: "ready", url });
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) setState({ kind: "failed", status: isAxiosError(error) ? error.response?.status : undefined });
      });
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url); };
  }, [path]);
  if (state.kind === "loading") return <div className="wx-attendance-photo-placeholder wx-attendance-photo-loading" role="status" aria-busy="true">{t("Loading attendance photo…")}</div>;
  if (state.kind === "failed") {
    const denied = state.status === 401 || state.status === 403;
    const missing = state.status === 404;
    return <div className="wx-attendance-photo-placeholder" role="alert">
      <p>{t(denied ? "You no longer have access to this photo." : missing ? "Photo unavailable. The attendance record is unchanged." : "The photo could not load. Try again.")}</p>
      {!denied && !missing ? <Button type="button" className="wx-attendance-action" variant="outline" onClick={retry}>{t("Retry")}</Button> : null}
    </div>;
  }
  const failedDecode = () => setState({ kind: "failed" });
  return tileKind ? <PhotoTile url={state.url} alt={alt} kind={tileKind} onError={failedDecode} />
    : <ZoomPhoto url={state.url} alt={alt} onError={failedDecode} />;
}

function ZoomPhoto({ url, alt, onError }: { url: string; alt: string; onError: () => void }) {
  const { t } = useLanguage();
  const [zoom, setZoom] = useState(1);
  return <>
    <div className="wx-attendance-zoom-toolbar">
      <Button type="button" className="wx-attendance-action" variant="outline" disabled={zoom <= 1} onClick={() => setZoom(value => value - .5)}><ZoomOut aria-hidden="true" size={18} />{t("Zoom out")}</Button>
      <Button type="button" className="wx-attendance-action" variant="outline" disabled={zoom >= 3} onClick={() => setZoom(value => value + .5)}><ZoomIn aria-hidden="true" size={18} />{t("Zoom in")}</Button>
    </div>
    <div className="wx-attendance-image-zoom"><img src={url} alt={alt} style={{ width: `${zoom * 100}%`, maxWidth: "none" }} onError={onError} /></div>
  </>;
}

function PhotoTile({ url, alt, kind, onError }: { url: string; alt: string; kind: ProtectedAttendancePhotoProps["kind"]; onError: () => void }) {
  const { t, language } = useLanguage();
  return <Dialog>
    <DialogTrigger asChild><button type="button" className="wx-attendance-photo-tile" aria-label={t(kind === 'check-in' ? 'Enlarge check-in photo' : 'Enlarge check-out photo')}>
      <img src={url} alt={alt} onError={onError} /><ZoomIn aria-hidden="true" size={18} />
    </button></DialogTrigger>
    <DialogContent className="workspace wx-attendance-photo-dialog" dir={language === 'ur' ? 'rtl' : 'ltr'} lang={language === 'ur' ? 'ur-PK' : 'en-PK'} showCloseButton={false}>
      <DialogTitle>{alt}</DialogTitle>
      <DialogDescription>{t('Protected attendance photo.')}</DialogDescription>
      <ZoomPhoto url={url} alt={alt} onError={onError} />
      <DialogClose asChild><Button type="button" className="wx-attendance-action" variant="outline">{t('Close photo')}</Button></DialogClose>
    </DialogContent>
  </Dialog>;
}

function PhotoDialog({ path, kind, presentation }: { path: string; kind: ProtectedAttendancePhotoProps["kind"]; presentation: "button" | "tile" }) {
  const { t, language } = useLanguage();
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const title = t(kind === "check-in" ? "Check-in photo" : "Check-out photo");
  if (presentation === 'tile') return <PhotoBytes key={attempt} path={path} alt={title} retry={() => setAttempt(value => value + 1)} tileKind={kind} />;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" className="wx-attendance-action" variant="outline">{t(kind === "check-in" ? "View check-in photo" : "View check-out photo")}</Button></DialogTrigger>
    <DialogContent className="workspace wx-attendance-photo-dialog" dir={language === 'ur' ? 'rtl' : 'ltr'} lang={language === 'ur' ? 'ur-PK' : 'en-PK'} showCloseButton={false}>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{t("Protected attendance photo.")}</DialogDescription>
      {open ? <PhotoBytes key={attempt} path={path} alt={title} retry={() => setAttempt(value => value + 1)} /> : null}
      <DialogClose asChild><Button type="button" className="wx-attendance-action" variant="outline">{t("Close")}</Button></DialogClose>
    </DialogContent>
  </Dialog>;
}

export default function ProtectedAttendancePhoto({ attendanceId, kind, photo, presentation = "button", missingMessage }: ProtectedAttendancePhotoProps) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const path = `/attendance/${attendanceId}/photos/${kind}`;
  if (!user || photo?.state !== "AVAILABLE" || photo.path !== path || !Number.isSafeInteger(attendanceId) || attendanceId < 1) {
    const message = t(photo?.state === "LEGACY_RESTRICTED" ? "This earlier photo is unavailable. The attendance record is unchanged." : missingMessage ?? "No photo recorded.");
    return presentation === 'tile'
      ? <div className="wx-attendance-photo-placeholder"><Camera aria-hidden="true" size={24} /><p>{message}</p></div>
      : <span className="wx-attendance-photo-missing">{message}</span>;
  }
  // Remount on role/tenant/account/record change: an old user's in-memory bytes
  // and open dialog must never survive a different authenticated principal.
  return <PhotoDialog key={`${user.role}:${user.companyId}:${user.id}:${path}:${presentation}`} path={path} kind={kind} presentation={presentation} />;
}
