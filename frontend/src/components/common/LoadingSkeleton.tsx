import { Building2, Camera, ClipboardList, Users } from "lucide-react";
import { useLanguage } from "@/i18n/context";
import "./loading-skeleton.css";

export type SkeletonVariant =
  "overview" | "table" | "detail" | "metrics" | "panel";
type Props = { variant?: SkeletonVariant; header?: boolean };

function Line({
  width = "medium",
  className = "",
}: {
  width?: "short" | "medium" | "long" | "full";
  className?: string;
}) {
  return <span className={`wx-sk-block wx-sk-line wx-sk-${width} ${className}`} />;
}

function Metrics({
  count = 4,
  compact = false,
}: {
  count?: number;
  compact?: boolean;
}) {
  return (
    <div
      className={`wx-sk-metrics wx-sk-count-${count} ${compact ? "wx-sk-metrics-compact" : ""}`}
    >
      {Array.from(
        { length: count },
        (_, index) => [Users, ClipboardList, Camera, Building2][index % 4],
      ).map((Icon, index) => (
        <div className="wx-sk-metric" key={index}>
          <div className="wx-sk-metric-top">
            <Line width="medium" />
            <span className={`wx-sk-metric-icon wx-sk-tone-${index % 4}`}>
              <Icon size={17} strokeWidth={1.6} />
            </span>
          </div>
          <div className="wx-sk-metric-value">
            <span className="wx-sk-block wx-sk-number" />
            <span className="wx-sk-block wx-sk-unit" />
          </div>
          <Line width="long" />
          <div className="wx-sk-metric-track">
            <span className="wx-sk-block" />
          </div>
        </div>
      ))}
    </div>
  );
}

export {
  Line as SkeletonLine,
  Metrics as SkeletonMetrics,
  Chart as SkeletonChart,
  Rows as SkeletonRows,
  PanelHeading as SkeletonPanelHeading,
};

function Rows({
  count = 4,
  table = false,
}: {
  count?: number;
  table?: boolean;
}) {
  return (
    <div className={`wx-sk-rows ${table ? "wx-sk-table-rows" : ""}`}>
      {Array.from({ length: count }, (_, index) => (
        <div className="wx-sk-row" key={index}>
          <span
            className={`wx-sk-block wx-sk-avatar ${index % 2 ? "wx-sk-avatar-square" : ""}`}
          />
          <div className="wx-sk-row-identity">
            <Line width={index % 2 ? "long" : "medium"} />
            <Line width={index % 2 ? "medium" : "short"} />
          </div>
          {table ? (
            <>
              <div className="wx-sk-row-column">
                <Line width="medium" />
                <Line width="short" />
              </div>
              <div className="wx-sk-row-column wx-sk-row-progress">
                <Line width="short" />
                <span className="wx-sk-block wx-sk-progress" />
              </div>
            </>
          ) : null}
          <span className={`wx-sk-block wx-sk-pill wx-sk-pill-${index % 3}`} />
          <span className="wx-sk-block wx-sk-row-action" />
        </div>
      ))}
    </div>
  );
}

function PanelHeading() {
  return (
    <div className="wx-sk-panel-heading">
      <div>
        <Line width="medium" />
        <Line width="long" />
      </div>
      <span className="wx-sk-block wx-sk-small-action" />
    </div>
  );
}

function Table({ compact = false }: { compact?: boolean }) {
  return (
    <div className="wx-sk-panel wx-sk-table">
      <PanelHeading />
      <div className="wx-sk-table-labels">
        <Line width="medium" />
        <Line width="short" />
        <Line width="short" />
        <Line width="short" />
      </div>
      <Rows count={compact ? 3 : 5} table />
      {!compact ? (
        <div className="wx-sk-table-footer">
          <Line width="short" />
          <div>
            {[0, 1, 2].map((i) => (
              <span key={i} className="wx-sk-block wx-sk-page" />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Chart() {
  return (
    <div className="wx-sk-panel wx-sk-chart">
      <PanelHeading />
      <div className="wx-sk-chart-content">
        <span className="wx-sk-block wx-sk-chart-placeholder" />
      </div>
    </div>
  );
}

function Detail() {
  return (
    <div className="wx-sk-detail">
      <div className="wx-sk-panel">
        <PanelHeading />
        <div className="wx-sk-detail-media">
          <span className="wx-sk-media-icon">
            <Camera size={34} strokeWidth={1.3} />
          </span>
          <Line width="short" />
        </div>
        <Rows count={2} />
      </div>
      <div className="wx-sk-panel">
        <PanelHeading />
        <div className="wx-sk-detail-facts">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <Line width="short" />
              <Line width={i % 2 ? "medium" : "long"} />
            </div>
          ))}
        </div>
        <Rows count={2} />
        <div className="wx-sk-detail-actions">
          <span className="wx-sk-block" />
          <span className="wx-sk-block" />
        </div>
      </div>
    </div>
  );
}

/** Decorative placeholders are hidden; one concise status announces the entire region. */
export default function LoadingSkeleton({
  variant = "table",
  header = false,
}: Props) {
  const { t } = useLanguage();
  return (
    <div
      className={`loading-skeleton wx-loading-skeleton wx-sk-variant-${variant}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={t("Loading…")}
    >
      <span className="wx-loading-label">{t("Loading…")}</span>
      <div className="wx-sk-content" aria-hidden="true">
        {header ? (
          <div className="wx-sk-header">
            <div>
              <Line width="short" />
              <span className="wx-sk-block wx-sk-title" />
              <Line width="long" />
            </div>
            <span className="wx-sk-block wx-sk-header-action" />
          </div>
        ) : null}
        {variant === "overview" ||
        variant === "metrics" ||
        (header && variant === "table") ? (
          <Metrics />
        ) : null}
        {variant === "overview" ? (
          <div className="wx-sk-overview">
            <div className="wx-sk-overview-main">
              <Chart />
              <Table compact />
            </div>
            <div className="wx-sk-overview-side">
              <div className="wx-sk-panel">
                <PanelHeading />
                <Rows count={3} />
              </div>
              <div className="wx-sk-panel">
                <PanelHeading />
                <Rows count={3} />
              </div>
            </div>
          </div>
        ) : variant === "detail" ? (
          <Detail />
        ) : variant === "panel" ? (
          <div className="wx-sk-panel wx-sk-compact">
            <Rows count={3} />
          </div>
        ) : variant === "table" ? (
          <Table />
        ) : null}
      </div>
    </div>
  );
}
