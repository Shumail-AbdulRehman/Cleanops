import { Link } from "react-router-dom";
import { ArrowUpRight, Users, ClipboardList, Camera, Send } from "lucide-react";
import { useLanguage } from "@/i18n/context";
import type { OperationOverview } from "@/pages/Manager/operations";
import { dailyLink, reviewLink } from "@/pages/Manager/operations";

export default function OperationalSummary({
  data,
  params,
}: {
  data: OperationOverview;
  params: URLSearchParams;
}) {
  const { t } = useLanguage();
  const day = params.get("date");
  const metrics = [
    {
      label: "Staff present",
      value: data.metrics.present,
      denominator: data.metrics.scheduled,
      hint: "Scheduled staff for this day",
      Icon: Users,
      tone: "green",
      href: dailyLink(params, { tab: "staff", attendance: "present" }),
    },
    {
      label:
        day && day !== "today" ? "Tasks due for this day" : "Tasks due today",
      value: data.metrics.totalTasks,
      hint: "Includes unassigned work",
      Icon: ClipboardList,
      tone: "blue",
      href: dailyLink(params, { tab: "tasks" }),
    },
    {
      label: "Work submitted",
      value: data.metrics.submitted,
      hint: "Submitted is separate from approved.",
      Icon: Send,
      tone: "green",
      href: dailyLink(params, { tab: "tasks", status: "submitted" }),
    },
    {
      label: "Waiting for review",
      value: data.metrics.reviewCount,
      hint: "Cases from this day’s work",
      Icon: Camera,
      tone: "amber",
      href: reviewLink(params),
    },
  ];
  return (
    <section className="ops-metrics" aria-label={t("Daily summary")}>
      {metrics.map(({ label, value, denominator, hint, Icon, tone, href }) => (
        <Link className="ops-metric" key={label} to={href}>
          <span className={"metric-icon tone-" + tone}>
            <Icon size={23} strokeWidth={1.8} />
          </span>
          <div className="metric-copy">
            <span>{t(label)}</span>
            <strong>
              {value}
              {denominator !== undefined ? (
                <small>
                  {" "}
                  {t("of")} {denominator}
                </small>
              ) : null}
            </strong>
            <small>{t(hint)}</small>
          </div>
          <ArrowUpRight size={15} className="metric-arrow" aria-hidden="true" />
        </Link>
      ))}
    </section>
  );
}
