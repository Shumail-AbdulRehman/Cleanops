import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/context";
import { useOnline } from "@/hooks/useOnline";
import LoadingSkeleton, {
  type SkeletonVariant,
} from "@/components/common/LoadingSkeleton";
import PageLoadingSkeleton from "@/components/common/PageLoadingSkeleton";
import type { PageLoadingLayout } from "@/components/common/loadingLayout";
import { RefreshCw, TriangleAlert, WifiOff } from "lucide-react";
export default function OperationsState({
  loading,
  error,
  retry,
  skeleton = "panel",
  layout,
}: {
  loading?: boolean;
  error?: unknown;
  retry?: () => void;
  skeleton?: SkeletonVariant;
  layout?: PageLoadingLayout;
}) {
  const { t } = useLanguage();
  const online = useOnline();
  if (error) {
    const status = (error as { response?: { status?: number } })?.response
      ?.status;
    return (
      <div className="wx-page-state wx-page-state--error" role="alert">
        <div className="wx-page-state__icon" aria-hidden="true"><TriangleAlert size={24} /></div>
        <h2 className="wx-page-state__title">{t("This page could not load")}</h2>
        {status === 403 && <p className="wx-page-state__message">{t("You do not have access to this location. Choose an assigned location or ask your owner.")}</p>}
        <p className="wx-page-state__message">{t("Check your connection and try again. Your saved records have not changed.")}</p>
        {retry && <div className="wx-page-state__actions">
          <Button type="button" onClick={retry}>
            <RefreshCw size={16} aria-hidden="true" />{t("Retry")}
          </Button>
        </div>}
      </div>
    );
  }
  if (loading)
    return layout ? (
      <PageLoadingSkeleton layout={layout} section />
    ) : (
      <LoadingSkeleton variant={skeleton} />
    );
  return !online ? (
    <p className="wx-stale-notice" role="status">
      <WifiOff size={18} aria-hidden="true" />
      <span>{t(
        "You are viewing the last loaded information. Reconnect and refresh before making changes.",
      )}</span>
    </p>
  ) : null;
}
