import { useEffect, useState, useRef } from "react";
import { CircleAlert, Clock3, Expand, ShieldAlert, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useLanguage } from "@/i18n/context";
import { getEvidenceBlob } from "./api";
import "./task-photos-v6.css";
export default function ProtectedEvidence({
  assetId,
  privacyState,
  allowRestrictedReview = false,
  alt = "Verification evidence",
  variant = "default",
}: {
  assetId: string;
  privacyState?: string;
  allowRestrictedReview?: boolean;
  alt?: string;
  variant?: "default" | "workspace" | "thumbnail";
}) {
  const { t } = useLanguage();
  const [image, setImage] = useState<{ key: string; url: string } | null>(null);
  const [failed, setFailed] = useState<{key: string; status?: number} | null>(null);
  const [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const held = ["PRIVACY_HOLD", "HELD", "HOLD"].includes(privacyState ?? "");
  const reviewAllowed = held && allowRestrictedReview;
  const allowed = ["SAFE", "NOT_REQUIRED"].includes(privacyState ?? "") || reviewAllowed;
  const key = `${assetId}:${privacyState}`;
  const root = useRef<HTMLElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  function enlarge(button: HTMLButtonElement) {
    opener.current = button;
    setZoom(1);
    setExpanded(true);
  }
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!allowed || !root.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [allowed]);
  useEffect(() => {
    if (!allowed || !visible) return;
    const abort = new AbortController();
    let url: string | undefined;
    getEvidenceBlob(assetId, abort.signal)
      .then((blob) => {
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setImage({ key, url });
        setFailed(null);
      })
      .catch((error: {response?:{status?:number}}) => {
        if (!abort.signal.aborted) setFailed({key, status:error.response?.status});
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [assetId, key, allowed, retry, visible]);
  if (variant === 'thumbnail') return <span ref={node=>{root.current=node;}} className="v5-evidence-thumbnail">
    {!allowed ? <span>{t('Photo restricted')}</span> : failed?.key === key ? <span>{t('Photo unavailable')}</span> : image?.key === key ? <img src={image.url} alt={t(alt)} onError={()=>setFailed({key})}/> : <span>{t('Loading…')}</span>}
  </span>;
  if (!allowed)
    return (
      <p className={`ops-evidence-placeholder wx-evidence-state wx-evidence-state--${held ? "held" : "pending"}`}>
        {held ? <ShieldAlert size={24} aria-hidden="true" /> : <Clock3 size={24} aria-hidden="true" />}
        {t(
          held
            ? "Sensitive image restricted. Only an authorized privacy review can access it."
            : "Privacy check pending. Photo is not available for routine review yet.",
        )}
      </p>
    );
  const url = image?.key === key ? image.url : null;
  if (failed?.key === key)
    return (
      <div role="alert" className="ops-evidence-placeholder wx-evidence-state wx-evidence-state--error">
        <CircleAlert size={24} aria-hidden="true" />
        {t(failed.status === 403 || failed.status === 401 ? "You do not have access to this evidence." : failed.status === 404 || failed.status === 410 ? "This evidence is no longer available." : "Evidence could not load. Retry when connected.")}
        {![401,403,404,410].includes(failed.status ?? 0) && <Button variant="outline" onClick={() => setRetry((r) => r + 1)}>
          {t("Retry")}
        </Button>}
      </div>
    );
  return (
    <div ref={node=>{root.current=node;}}>
      {url ? (
        <div className="ops-protected-image">
          {reviewAllowed ? (
            <p className="ops-privacy-notice">
              {t(
                "Privacy flag recorded · Manager access. Viewing does not allow acceptance.",
              )}
            </p>
          ) : null}
          {variant === 'workspace' && <div className="v5-evidence-toolbar">
            <Button variant="ghost" aria-label={t('Zoom out')} disabled={zoom<=1} onClick={()=>setZoom(z=>Math.max(1,z-.5))}><ZoomOut size={16}/></Button>
            <output aria-label={t('Photo zoom')}>{Math.round(zoom*100)}%</output>
            <Button variant="ghost" aria-label={t('Zoom in')} disabled={zoom>=3} onClick={()=>setZoom(z=>Math.min(3,z+.5))}><ZoomIn size={16}/></Button>
            <Button variant="ghost" onClick={()=>setZoom(1)}>{t('Fit')}</Button>
            <Button variant="ghost" onClick={event=>enlarge(event.currentTarget)}><Expand size={16}/>{t('Enlarge photo')}</Button>
          </div>}
          {variant === 'workspace' ? <div className="v5-evidence-stage" role="region" aria-label={t('Photo inspection area')} tabIndex={0}><img alt={t(alt)} src={url} onError={()=>setFailed({key})} style={{width:`${zoom*100}%`,height:`${zoom*100}%`,maxWidth:'none'}}/></div> : <><button
            className="ops-image-button"
            onClick={event => enlarge(event.currentTarget)}
            aria-label={t("Enlarge photo")}
          >
            <img alt={t(alt)} src={url} onError={()=>setFailed({key})} />
          </button>
          <Button
            variant="ghost"
            onClick={event => enlarge(event.currentTarget)}
          >
            <Expand size={16} />
            {t("Enlarge photo")}
          </Button></>}
          <Dialog open={expanded} onOpenChange={setExpanded}>
            <DialogContent className="workspace ops-image-dialog sm:max-w-5xl" onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus(); }}>
              <DialogTitle>{t("Review photo")}</DialogTitle>
              <DialogDescription>{t(alt)}</DialogDescription>
              <div className="ops-zoom-toolbar">
                <Button variant="outline" onClick={()=>setZoom(1)}>{t("Fit")}</Button>
                <output aria-label={t("Photo zoom")}>{Math.round(zoom*100)}%</output>
                <Button
                  aria-label={t("Zoom out")}
                  variant="outline"
                  disabled={zoom <= 1}
                  onClick={() => setZoom((z) => z - 0.5)}
                >
                  <ZoomOut size={18} />
                  {t("Zoom out")}
                </Button>
                <Button
                  aria-label={t("Zoom in")}
                  variant="outline"
                  disabled={zoom >= 3}
                  onClick={() => setZoom((z) => z + 0.5)}
                >
                  <ZoomIn size={18} />
                  {t("Zoom in")}
                </Button>
              </div>
              <div className="ops-image-zoom" role="region" aria-label={t("Enlarged photo inspection area")} tabIndex={0}>
                <img
                  alt={t(alt)}
                  src={url}
                  onError={()=>setFailed({key})}
                  style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
                />
              </div>
            </DialogContent>
          </Dialog>
        </div>
      ) : (
        <div role="status" className="ops-evidence-placeholder wx-evidence-state wx-evidence-state--loading">
          <span className="wx-evidence-skeleton" aria-hidden="true" />
          <span className="sr-only">{t("Loading protected photo…")}</span>
        </div>
      )}
    </div>
  );
}
