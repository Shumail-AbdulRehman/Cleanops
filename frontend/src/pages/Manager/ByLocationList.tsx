import { useId } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useLanguage } from "@/i18n/context";
import MeterRow from "@/components/workspace/MeterRow";
import SiteAvatar from "@/components/workspace/SiteAvatar";
import OperationsState from "./OperationsState";
import { dailyLink, scopeParams, type OperationOverview } from "./operations";
import "./today-charts-v6.css";

export interface ByLocationListProps {
  comparison?: OperationOverview["comparison"];
  params: URLSearchParams;
  loading?: boolean;
  error?: unknown;
  retry?: () => void;
}

export function ByLocationList({ comparison = [], params, loading, error, retry }: ByLocationListProps) {
  const { t, language } = useLanguage();
  const titleId = useId();
  const number = (value: number) => value.toLocaleString(language === "ur" ? "ur-PK" : "en-PK");
  // Unscheduled locations have no rate. Keep them after measured progress,
  // rather than assigning a fabricated zero; stable ties retain server order.
  const rows = [...comparison].sort((a, b) => (a.tasks > 0 ? a.submitted / a.tasks : Infinity) - (b.tasks > 0 ? b.submitted / b.tasks : Infinity)).slice(0, 6);
  return (
    <section className="wx-today-chart wx-today-chart--locations" aria-labelledby={titleId}>
      <div className="wx-today-chart__heading"><div><h2 id={titleId}>{t("By location")}</h2><p>{t("Lowest progress first.")}</p></div></div>
      {(error || (loading && !rows.length)) ? <OperationsState loading={loading && !rows.length} error={error} retry={retry} skeleton="panel" /> : null}
      {rows.length ? <ul className="wx-today-locations">
        {rows.map(row => <li key={row.location.id}>
          <Link to={dailyLink(params, { locationId: String(row.location.id) })} aria-label={t("View daily records: {name}", { name: row.location.name })}>
            <SiteAvatar name={row.location.name} size="small" />
            <MeterRow name={row.location.name} figure={t("{count} of {total}", { count: number(row.submitted), total: number(row.tasks) })} value={row.tasks > 0 ? row.submitted : null} max={row.tasks} />
          </Link>
          {row.tasks === 0 && <p className="wx-today-locations__no-tasks">{t("{count} submitted", { count: number(row.submitted) })} · {t("{count} due", { count: number(row.tasks) })}</p>}
          <p>{t("{count} of {total} staff checked in", { count: number(row.present), total: number(row.scheduled) })}</p>
        </li>)}
      </ul> : !loading && !error ? <div className="wx-today-chart__empty"><p>{t("No locations in this scope.")}</p><p>{t("Choose a location to see its daily records.")}</p></div> : null}
      {comparison.length > 6 && <Link className="wx-today-chart__more" to={`/dashboard?${new URLSearchParams(scopeParams(params))}`}>{t("View all locations")}<ArrowRight size={16} aria-hidden="true" /></Link>}
    </section>
  );
}

export default ByLocationList;
