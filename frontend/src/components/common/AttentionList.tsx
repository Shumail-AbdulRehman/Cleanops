import { Link } from "react-router-dom";
import {
  Camera,
  Clock3,
  Users,
  ArrowRight,
  CheckCircle2,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/context";
import {
  dailyLink,
  locationTaskLink,
  reviewLink,
  type OperationOverview,
} from "@/pages/Manager/operations";
import { plainReason } from "@/pages/Verification/presentation";

export default function AttentionList({
  data,
  params,
  limit = 4,
}: {
  data: OperationOverview;
  params: URLSearchParams;
  limit?: number;
}) {
  const { t } = useLanguage();
  // Include different actionable concerns before filling the bounded preview.
  const concerns = [
    "review",
    "OVERDUE",
    "MISSING_CHECKIN",
    "UNASSIGNED",
  ].flatMap((key) => {
    const first = data.attention.find(
      (a) => a.kind === key || a.reasonCode === key,
    );
    return first ? [first] : [];
  });
  const preview = [
    ...concerns,
    ...data.attention.filter((a) => !concerns.includes(a)),
  ].slice(0, limit);
  // Attention includes attendance and task issues as well as photo reviews.
  // Each collection needs its own destination; the reviews inbox cannot list them all.
  const collections = [
    {
      visible: data.attention.some((a) => a.reasonCode === "OVERDUE"),
      label: "Overdue tasks",
      href:
        dailyLink(params, { tab: "tasks", status: "overdue" }) +
        "#daily-records",
    },
    {
      visible: data.attention.some((a) => a.kind === "attendance"),
      label: "Missing check-ins",
      href:
        dailyLink(params, { tab: "staff", attendance: "absent" }) +
        "#daily-records",
    },
    {
      visible: data.attention.some((a) => a.reasonCode === "UNASSIGNED"),
      label: "Unassigned work",
      href:
        dailyLink(params, { tab: "tasks", status: "unassigned" }) +
        "#daily-records",
    },
    {
      visible: data.metrics.reviewCount > 0,
      label: "View all reviews",
      href: reviewLink(params),
    },
  ].filter((collection) => collection.visible);
  return (
    <section
      className={
        "ops-panel attention-panel " +
        (data.attention.length ? "has-attention" : "")
      }
    >
      <div className="ops-panel-heading">
        <div>
          <h2>{t("Needs your attention")}</h2>
          <p>{t("Start with these items from this day.")}</p>
        </div>
      </div>
      {data.attention.length ? (
        preview.map((a) => {
          const href =
            a.kind === "review"
              ? "/exceptions/" +
                a.caseId +
                "?returnTo=" +
                encodeURIComponent(reviewLink(params))
              : a.kind === "attendance"
                ? dailyLink(params, {
                    tab: "staff",
                    q: a.staff?.name ?? "",
                    attendance: "absent",
                  })
                : a.task
                  ? locationTaskLink(a.task)
                  : dailyLink(params, { tab: "tasks" });
          const Icon =
            a.kind === "attendance"
              ? Users
              : a.kind === "review"
                ? Camera
                : a.reasonCode === "UNASSIGNED"
                  ? UserPlus
                  : Clock3;
          return (
            <div className="ops-issue-row" key={a.key}>
              <span
                className={
                  "ops-symbol " +
                  (a.kind === "review" ? "tone-amber" : "tone-red")
                }
              >
                <Icon size={19} />
              </span>
              <div className="attention-copy">
                <strong>
                  {a.task?.areaNameSnapshot ??
                    a.task?.title ??
                    a.staff?.name ??
                    a.location?.name}
                </strong>
                <p className="attention-reason">
                  {t(plainReason(a.reasonCode))}
                </p>
                <small>
                  {[
                    a.task?.staff?.name,
                    a.location?.name ?? a.task?.location?.name,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </div>
              <Button
                asChild
                variant={a.kind === "review" ? "default" : "outline"}
              >
                <Link to={href}>
                  {t(
                    a.kind === "review"
                      ? "Review"
                      : a.kind === "attendance"
                        ? "Check attendance"
                        : "Open task",
                  )}
                  <ArrowRight size={14} />
                </Link>
              </Button>
            </div>
          );
        })
      ) : (
        <div className="attention-clear">
          <CheckCircle2 size={26} />
          <div>
            <strong>{t("No issues right now")}</strong>
            <p>{t("Keep track of your team and scheduled work below.")}</p>
          </div>
        </div>
      )}
      {collections.length ? (
        <div className="panel-footer attention-footer">
          <span>
            {t("Showing {count} priority items", { count: preview.length })}
          </span>
          <nav aria-label={t("View all attention items")}>
            {collections.map(({ label, href }) => (
              <Link key={label} to={href}>
                {t(label)}
                <ArrowRight size={14} />
              </Link>
            ))}
          </nav>
        </div>
      ) : null}
    </section>
  );
}
