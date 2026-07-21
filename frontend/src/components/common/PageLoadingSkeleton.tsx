import { useLocation } from "react-router-dom";
import { useSelector } from "react-redux";
import type { RootState } from "@/store/store";
import { useLanguage } from "@/i18n/context";
import {
  pageLoadingLayout,
  pageLoadingTab,
  type PageLoadingLayout,
} from "./loadingLayout";
import {
  SkeletonLine as Line,
  SkeletonMetrics as Metrics,
  SkeletonRows as Rows,
  SkeletonPanelHeading as PanelHeading,
} from "./LoadingSkeleton";

function Header({
  title,
  back = false,
  actions = 1,
}: {
  title?: string;
  back?: boolean;
  actions?: number;
}) {
  const { t } = useLanguage();
  return (
    <>
      {back ? <Line width="short" className="wx-sk-back-link" /> : null}
      <div className="wx-sk-header wx-sk-page-header">
        <div>
          {title ? <h1>{t(title)}</h1> : <span className="wx-sk-block wx-sk-title" />}
          <Line width="long" />
        </div>
        <div className="wx-sk-header-buttons">
          {Array.from({ length: actions }, (_, i) => (
            <span className="wx-sk-block wx-sk-header-action" key={i} />
          ))}
        </div>
      </div>
    </>
  );
}
function Tabs({ count = 4 }: { count?: number }) {
  return (
    <div className="wx-sk-tabs">
      {Array.from({ length: count }, (_, i) => (
        <span className={`wx-sk-block ${i === 0 ? "wx-sk-selected" : ""}`} key={i} />
      ))}
    </div>
  );
}
function Filters({
  count = 2,
  dates = false,
}: {
  count?: number;
  dates?: boolean;
}) {
  return (
    <div className={`wx-sk-filters ${dates ? "wx-sk-filters-dates" : ""}`}>
      {dates ? (
        <div className="wx-sk-quick-filters">
          <Line width="short" />
          <div>
            {[0, 1, 2].map((i) => (
              <span className="wx-sk-block" key={i} />
            ))}
          </div>
        </div>
      ) : null}
      <div className="wx-sk-filter-fields">
        {Array.from({ length: count }, (_, i) => (
          <div key={i}>
            <Line width="short" />
            <span className="wx-sk-block wx-sk-filter-control" />
          </div>
        ))}
      </div>
    </div>
  );
}
function Table({
  columns = 5,
  rows = 4,
  avatars = true,
  photos = false,
}: {
  columns?: number;
  rows?: number;
  avatars?: boolean;
  photos?: boolean;
}) {
  return (
    <div
      className="wx-sk-panel wx-sk-page-table"
      style={{ "--sk-columns": columns } as React.CSSProperties}
    >
      <div className="wx-sk-page-table-head">
        {Array.from({ length: columns }, (_, i) => (
          <Line key={i} width="short" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div className="wx-sk-page-table-row" key={row}>
          {Array.from({ length: columns }, (_, col) => (
            <div key={col} className={col === 0 ? "wx-sk-table-identity" : ""}>
              {col === 0 ? (
                <>
                  {avatars ? <span className="wx-sk-block wx-sk-avatar" /> : null}
                  <span className="wx-sk-row-identity">
                    <Line width={row % 2 ? "long" : "medium"} />
                    <Line width="short" />
                  </span>
                </>
              ) : photos && col >= columns - 2 ? (
                <span className="wx-sk-block wx-sk-table-photo" />
              ) : col === columns - 1 ? (
                <span className="wx-sk-block wx-sk-pill" />
              ) : (
                <Line width={col % 2 ? "medium" : "short"} />
              )}
            </div>
          ))}
        </div>
      ))}
      <div className="wx-sk-table-footer">
        <Line width="short" />
        <div>
          {[0, 1, 2].map((i) => (
            <span className="wx-sk-block wx-sk-page" key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
function Facts({ rows = 7 }: { rows?: number }) {
  return (
    <div className="wx-sk-fact-list">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i}>
          <Line width="short" />
          <Line width={i % 2 ? "medium" : "long"} />
        </div>
      ))}
    </div>
  );
}
function Bars({ vertical = false }: { vertical?: boolean }) {
  return (
    <div
      className={`wx-sk-performance ${vertical ? "wx-sk-performance-vertical" : ""}`}
    >
      {[56, 78, 36, 63].map((width, i) => (
        <div key={i}>
          <Line width="short" />
          <span className="wx-sk-bar-track">
            <span
              className={`wx-sk-block wx-sk-tone-${i}`}
              style={
                vertical ? { height: `${width}%` } : { width: `${width}%` }
              }
            />
          </span>
        </div>
      ))}
    </div>
  );
}
function Panel({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  const { t } = useLanguage();
  return (
    <div className="wx-sk-panel">
      {title ? (
        <div className="wx-sk-panel-heading">
          <div>
            <h2>{t(title)}</h2>
            <Line width="long" />
          </div>
        </div>
      ) : (
        <PanelHeading />
      )}
      {children}
    </div>
  );
}
function Schedule() {
  return (
    <div className="wx-sk-schedule">
      <div className="wx-sk-schedule-period">
        <Line width="long" />
        <Line width="medium" />
      </div>
      <div className="wx-sk-panel">
        {Array.from({ length: 7 }, (_, i) => (
          <div className="wx-sk-schedule-day" key={i}>
            <div>
              <Line width="medium" />
              <Line width="short" />
            </div>
            <div className="wx-sk-schedule-task">
              <Line width="long" />
              <Line width="medium" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function TeamDetail({ tab }: { tab: string }) {
  return (
    <>
      <Header back actions={1} />
      <div className="wx-sk-contact-strip">
        {[0, 1, 2].map((i) => (
          <Line width="long" key={i} />
        ))}
      </div>
      <Filters count={5} dates />
      <Metrics count={5} compact />
      <Tabs />
      {tab === "overview" ? (
        <>
          <div className="wx-sk-equal-columns">
            <Panel title="Profile">
              <Facts />
            </Panel>
            <Panel title="Task performance">
              <Bars />
            </Panel>
          </div>
          <Panel title="Attendance summary">
            <div className="wx-sk-attendance-summary">
              {[0, 1, 2, 3].map((i) => (
                <div className={`wx-sk-tone-${i}`} key={i}>
                  <span className="wx-sk-block wx-sk-number" />
                  <Line width="short" />
                </div>
              ))}
            </div>
          </Panel>
        </>
      ) : (
        <Table
          columns={tab === "attendance" ? 8 : 6}
          photos={tab === "attendance"}
        />
      )}
    </>
  );
}
function Chart() {
  return (
    <Panel title="Cleaning progress">
      <div className="wx-sk-progress-body">
        <span className="wx-sk-block wx-sk-progress-track" />
        <div className="wx-sk-progress-figures">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <Line width="short" />
              <span className="wx-sk-block wx-sk-number" />
            </div>
          ))}
        </div>
        <div className="wx-sk-contact-strip">
          <Line width="medium" />
          <Line width="medium" />
        </div>
        <Line width="long" />
      </div>
    </Panel>
  );
}
function Overview({ owner, header }: { owner: boolean; header: boolean }) {
  const chart = <Chart />;
  const attention = (
    <Panel>
      <Rows count={3} />
    </Panel>
  );
  return (
    <>
      {header ? (
        <Header
          title={owner ? "Company overview" : "Today’s work"}
          actions={2}
        />
      ) : null}
      <Metrics />
      <div className="wx-sk-overview-flow wx-sk-page-overview">
        <div className="wx-sk-overview-primary">
          {owner ? (
            <>
              {chart}
              {attention}
            </>
          ) : (
            <>
              {attention}
              {chart}
            </>
          )}
        </div>
        <Panel title="Locations today">
          <Table columns={5} rows={3} avatars={false} />
        </Panel>
        {owner ? (
          <Panel title="Compare the last 7 days">
            <div className="wx-sk-overview-trends">
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  <Line width="long" />
                  <div className="wx-sk-trend-pair">
                    <span className="wx-sk-block" />
                    <span className="wx-sk-block" />
                  </div>
                  <Line width="medium" />
                </div>
              ))}
            </div>
          </Panel>
        ) : null}
        <Panel title="Today’s tasks">
          <div className="wx-sk-wide-task-rows">
            <Table columns={3} rows={3} avatars={false} />
          </div>
        </Panel>
      </div>
    </>
  );
}
function LocationBody({ tab }: { tab: string }) {
  if (tab === "overview")
    return (
      <>
        <div className="wx-sk-location-columns">
          <Panel>
            <Table columns={3} rows={3} avatars={false} />
          </Panel>
          <Panel>
            <Rows count={3} />
          </Panel>
        </div>
        <Panel>
          <Table columns={4} rows={3} />
        </Panel>
      </>
    );
  if (tab === "schedule") return <Schedule />;
  if (tab === "areas")
    return (
      <>
        <Filters count={2} />
        <Table columns={5} avatars={false} />
      </>
    );
  if (tab === "templates")
    return (
      <>
        <Filters count={2} />
        <Table columns={6} avatars={false} />
      </>
    );
  if (tab === "staff")
    return (
      <Panel title="Staff and shifts">
        <Table columns={5} />
      </Panel>
    );
  if (tab === "instances")
    return (
      <Panel title="Task history">
        <Tabs count={4} />
        <Table columns={8} />
      </Panel>
    );
  return <Table columns={tab === "staff" ? 5 : 8} />;
}
function Evidence({ verification = false }: { verification?: boolean }) {
  return (
    <>
      <div className="wx-sk-contact-strip">
        <Line width="medium" />
        <Line width="long" />
      </div>
      <Tabs count={3} />
      <div
        className={
          verification ? "wx-sk-verification-columns" : "wx-sk-review-columns"
        }
      >
        <Panel>
          {verification ? (
            <Rows count={6} />
          ) : (
            <>
              <div className="wx-sk-detail-media">
                <span className="wx-sk-block wx-sk-media-placeholder" />
              </div>
              <Facts rows={3} />
            </>
          )}
        </Panel>
        <Panel>
          {verification ? (
            <div className="wx-sk-detail-media wx-sk-review-photo" />
          ) : (
            <>
              <Facts rows={4} />
              <div className="wx-sk-decision-fields">
                <Line width="long" />
                <span className="wx-sk-block wx-sk-filter-control" />
                <span className="wx-sk-block wx-sk-note-field" />
                <span className="wx-sk-block wx-sk-filter-control" />
              </div>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}

/** One resolved layout serves both route-code loading and the page's initial data request. */
export default function PageLoadingSkeleton({
  layout,
  section = false,
}: {
  layout?: PageLoadingLayout;
  section?: boolean;
}) {
  const { t } = useLanguage();
  const { pathname, search } = useLocation();
  const owner = useSelector(
    (state: RootState) => state.auth.user?.role === "ADMIN",
  );
  const resolved = layout ?? pageLoadingLayout(pathname, owner);
  const tab = pageLoadingTab(resolved, new URLSearchParams(search).get("tab"));
  let content: React.ReactNode;
  switch (resolved) {
    case "team-detail":
      content = <TeamDetail tab={tab} />;
      break;
    case "owner-overview":
    case "manager-overview":
      content = (
        <Overview owner={resolved === "owner-overview"} header={!section} />
      );
      break;
    case "locations":
    case "team":
    case "managers":
      content = (
        <>
          {!section ? (
            <Header
              title={
                resolved === "locations"
                  ? "Locations"
                  : resolved === "team"
                    ? "Team"
                    : "Managers"
              }
            />
          ) : null}
          <Metrics count={3} compact />
          <Filters count={2} />
          <Table
            columns={resolved === "locations" ? 6 : resolved === "team" ? 7 : 4}
            avatars={resolved !== "locations"}
          />
        </>
      );
      break;
    case "attendance":
      content = (
        <>
          <Header title="Attendance" actions={0} />
          <Metrics compact />
          <Filters count={4} dates />
          <Table columns={9} photos />
        </>
      );
      break;
    case "location-detail":
      content = (
        <>
          <Header back actions={3} />
          <Tabs count={6} />
          <Metrics />
          <LocationBody tab={tab} />
        </>
      );
      break;
    case "today":
      content = (
        <>
          <Header title="Today" actions={2} />
          <Metrics />
          <div className="wx-sk-equal-columns">
            <Panel>
              <Rows count={3} />
            </Panel>
            <Chart />
          </div>
          <Tabs count={2} />
          <Filters count={2} />
          <Table columns={6} />
        </>
      );
      break;
    case "today-summary":
      content = (
        <>
          <Metrics />
          <div className="wx-sk-equal-columns">
            <Panel>
              <Rows count={3} />
            </Panel>
            <Chart />
          </div>
        </>
      );
      break;
    case "today-table":
      content = <Table columns={6} />;
      break;
    case "reviews":
      content = (
        <>
          {!section ? (
            <>
              <Header title="Reviews" actions={0} />
              <Tabs count={4} />
              <Filters count={3} />
            </>
          ) : null}
          <Line width="long" />
          <Table columns={6} avatars={false} />
        </>
      );
      break;
    case "review-detail":
      content = (
        <>
          <Header back={!section} actions={1} />
          <Evidence />
        </>
      );
      break;
    case "verification":
      content = (
        <>
          {!section ? <Header back actions={1} /> : null}
          <Evidence verification />
        </>
      );
      break;
    case "billing":
      content = (
        <>
          <Header title="Plan & usage" actions={2} />
          <Panel>
            <div className="wx-sk-usage-grid">
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  <Line width="medium" />
                  <span className="wx-sk-block wx-sk-number" />
                  <span className="wx-sk-block wx-sk-usage-track" />
                  <Line width="short" />
                </div>
              ))}
            </div>
          </Panel>
          <div className="wx-sk-plan-collapse">
            <Line width="long" />
          </div>
        </>
      );
      break;
    case "area":
      content = (
        <>
          <Header back actions={3} />
          <Tabs count={6} />
          {tab === "overview" || tab === "inventory" ? (
            <div className="wx-sk-area-layout">
              <Panel>
                <Table columns={5} avatars={false} />
              </Panel>
              <Panel>
                <div className="wx-sk-qr-placeholder wx-sk-block" />
                <Facts rows={3} />
              </Panel>
            </div>
          ) : tab === "qr" ? (
            <div className="wx-sk-qr-placeholder wx-sk-block" />
          ) : (
            <Table columns={6} avatars={false} />
          )}
        </>
      );
      break;
    case "area-setup":
      content = (
        <div className="wx-sk-setup-form">
          <Header title="Set up an area" back actions={0} />
          <Filters count={2} />
          <Panel>
            <Facts rows={5} />
          </Panel>
          <span className="wx-sk-block wx-sk-note-field" />
          <span className="wx-sk-block wx-sk-header-action" />
        </div>
      );
      break;
    case "area-table":
      content = <Table columns={4} rows={3} avatars={false} />;
      break;
    case "staff-preview":
      content = (
        <div className="wx-sk-staff-grid wx-sk-staff-preview">
          {[0, 1, 2, 3].map((i) => (
            <div className="wx-sk-table-identity" key={i}>
              <span className="wx-sk-block wx-sk-avatar" />
              <div className="wx-sk-row-identity">
                <Line width="medium" />
                <Line width="short" />
              </div>
            </div>
          ))}
        </div>
      );
      break;
    case "task-summary":
      content = <Facts rows={5} />;
      break;
    case "trends":
      content = <Bars />;
      break;
    case "schedule":
      content = <Schedule />;
      break;
    default:
      content = (
        <>
          {!section ? <Header /> : null}
          <Table />
        </>
      );
  }
  return (
    <div
      className={`loading-skeleton wx-loading-skeleton wx-sk-page-loading wx-sk-layout-${resolved}`}
      data-loading-layout={resolved}
      data-loading-tab={tab}
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={t("Loading…")}
    >
      <span className="wx-loading-label">{t("Loading…")}</span>
      <div className="wx-sk-content" aria-hidden="true">
        {content}
      </div>
    </div>
  );
}
