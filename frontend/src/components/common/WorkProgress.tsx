import { CheckCircle2, Info } from "lucide-react";
import { Link } from "react-router-dom";
import { useLanguage } from "@/i18n/context";
import { dailyLink, type OperationOverview } from "@/pages/Manager/operations";

export default function WorkProgress({
  data,
  params,
}: {
  data: OperationOverview;
  params: URLSearchParams;
}) {
  const { t } = useLanguage();
  const segments = [
    {
      label: "Not started",
      n: data.chart.notStarted,
      tone: "pending",
      status: "not-started",
    },
    {
      label: "In progress",
      n: data.chart.inProgress,
      tone: "progress",
      status: "in-progress",
    },
    {
      label: "Overdue",
      n: data.chart.overdue,
      tone: "overdue",
      status: "overdue",
    },
    {
      label: "Work submitted",
      n: data.chart.submitted,
      tone: "submitted",
      status: "submitted",
    },
  ];
  return (
    <section className="ops-panel work-progress">
      <div className="ops-panel-heading">
        <div>
          <h2>{t("Cleaning progress")}</h2>
          <p>{t("Actual scheduled tasks")}</p>
        </div>
        <span className="panel-total">
          {t("Total")} <strong>{data.metrics.totalTasks}</strong>
        </span>
      </div>
      <div className="work-progress-body">
        <div
          className="work-progress-track"
          role="img"
          aria-label={segments.map((s) => t(s.label) + ": " + s.n).join(", ")}
        >
          {segments
            .filter((s) => s.n > 0)
            .map((s) => (
              <span
                key={s.tone}
                className={"progress-" + s.tone}
                style={{ flexGrow: s.n, flexBasis: 0 }}
              >
                {data.metrics.totalTasks && s.n / data.metrics.totalTasks > 0.1
                  ? s.n
                  : null}
              </span>
            ))}
          {!data.metrics.totalTasks ? (
            <span className="progress-empty">{t("No scheduled work")}</span>
          ) : null}
        </div>
        <div className="work-progress-legend">
          {segments.map((s) => (
            <Link
              key={s.tone}
              to={dailyLink(params, { tab: "tasks", status: s.status })}
            >
              <i className={"progress-" + s.tone} />
              <span>
                {t(s.label)}
                <strong>{s.n}</strong>
              </span>
            </Link>
          ))}
        </div>
        <div className="work-verification-summary">
          <CheckCircle2 size={16} />
          <span>
            {t("Verified")}: <strong>{data.metrics.verified}</strong>
          </span>
          <span>
            {t("Accepted with exceptions")}:{" "}
            <strong>{data.metrics.accepted}</strong>
          </span>
        </div>
        <p className="workspace-footnote">
          <Info size={15} />
          {t("Submitted work may still need checks or your decision.")}
        </p>
      </div>
    </section>
  );
}
