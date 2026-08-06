import { useQuery } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import type { RootState } from "@/store/store";
import { Link } from "react-router-dom";
import { formatInTimeZone } from "date-fns-tz";
import { ArrowRight, Camera } from "lucide-react";
import { useLanguage } from "@/i18n/context";
import { client } from "@/api/client";
import { getLocationById } from "../Location/api";
import { useGetLocations } from "../Location/queries";
import type { LocationWithCounts } from "../Location/types";
import {
  plainReason,
  verificationLabel,
  type VerificationSummary,
} from "../Verification/presentation";
import type { VerificationException } from "../Exceptions/types";
import OperationsState from "../Manager/OperationsState";
import DataTable from "@/components/common/DataTable";
import OperationStatus from "@/components/common/OperationStatus";
import TaskWorker from "@/components/common/TaskWorker";
import type { WorkerAssignment } from "../Task/taskAssignee";
import { Button } from "@/components/ui/button";
type Task = VerificationSummary & {
  id: number;
  areaId: number;
  title: string;
  shiftStart: string;
  shiftEnd: string;
  staffId: number | null;
  assignments: WorkerAssignment[];
};
export function AreaReviewPreview({
  areaId,
  locationId,
}: {
  areaId: number;
  locationId: number;
}) {
  const { t } = useLanguage();
  const scope = useSelector(
    (s: RootState) =>
      s.auth.user?.companyId + ":" + s.auth.user?.role + ":" + s.auth.user?.id,
  );
  const query = useQuery({
    queryKey: ["area-review-preview", scope, areaId],
    queryFn: async ({ signal }) =>
      (
        await client.get<{
          data: { cases: VerificationException[]; total: number };
        }>("/verification-exceptions", {
          params: {
            locationId,
            areaId,
            queue: "needs-me",
            period: "all",
            page: 1,
            pageSize: 3,
          },
          signal,
        })
      ).data.data,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });
  const returnTo =
    "/exceptions?locationId=" +
    locationId +
    "&areaId=" +
    areaId +
    "&queue=needs-me";
  return (
    <section className="ops-panel">
      <div className="ops-panel-heading">
        <h2>{t("Review needed")}</h2>
        <Link className="ops-text-link" to={returnTo}>
          {t("View all")}
          <ArrowRight size={14} />
        </Link>
      </div>
      <OperationsState
        loading={query.isPending}
        error={query.error}
        retry={() => void query.refetch()}
      />
      {query.data && !query.isError ? (
        query.data.cases.length ? (
          query.data.cases.map((c) => (
            <div className="ops-issue-row" key={c.id}>
              <span className="ops-symbol tone-amber">
                <Camera size={18} />
              </span>
              <div className="attention-copy">
                <strong>
                  {t(
                    plainReason(
                      c.displayReasonCode ??
                        c.issues?.find((i) => i.state !== "RESOLVED")
                          ?.reasonCode ??
                        "REVIEW_REQUIRED",
                    ),
                  )}
                </strong>
                <small>
                  {c.task?.staff?.name ??
                    c.taskInstance?.staff?.name ??
                    c.area?.name}
                </small>
              </div>
              <Button asChild>
                <Link
                  to={
                    "/exceptions/" +
                    c.id +
                    "?returnTo=" +
                    encodeURIComponent(returnTo)
                  }
                >
                  {t("Review")}
                </Link>
              </Button>
            </div>
          ))
        ) : (
          <p className="ops-empty">{t("No open reviews")}</p>
        )
      ) : null}
    </section>
  );
}
export default function AreaDailyWork({
  areaId,
  locationId,
  preview = false,
  onViewAll,
}: {
  areaId: number;
  locationId: number;
  preview?: boolean;
  onViewAll?: () => void;
}) {
  const { t, language } = useLanguage();
  const scope = useSelector(
    (s: RootState) =>
      s.auth.user?.companyId + ":" + s.auth.user?.role + ":" + s.auth.user?.id,
  );
  const locations = useGetLocations();
  const site = (locations.data?.data as LocationWithCounts[] | undefined)?.find(
    (l) => l.id === locationId,
  );
  const day = site
    ? formatInTimeZone(new Date(), site.timezone, "yyyy-MM-dd")
    : "";
  const query = useQuery({
    queryKey: ["area-daily-work", scope, locationId, day],
    queryFn: () =>
      getLocationById(String(locationId), {
        type: "range",
        dateFrom: day,
        dateTo: day,
      }),
    enabled: !!day,
    staleTime: 15000,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });
  const all: Task[] =
    query.data?.data.locationInfo?.taskInstances?.filter(
      (task: Task) => task.areaId === areaId,
    ) ?? [];
  return (
    <section className="ops-panel">
      <div className="ops-panel-heading">
        <div>
          <h2>{t("Cleaning today")}</h2>
          <p>
            {site
              ? day + " · " + site.timezone
              : t("Today’s scheduled work for this area")}
          </p>
        </div>
        {preview && onViewAll ? (
          <Button variant="ghost" onClick={onViewAll}>
            {t("View all tasks")}
            <ArrowRight size={14} />
          </Button>
        ) : null}
      </div>
      <OperationsState
        loading={
          locations.isPending ||
          (query.isPending && !locations.isError && !!site)
        }
        error={locations.error ?? query.error}
        retry={() =>
          void (locations.isError ? locations.refetch() : query.refetch())
        }
      />
      {!locations.isPending && !locations.isError && !site ? (
        <p className="ops-empty">
          {t("This location is not available in your workspace.")}
        </p>
      ) : null}
      {query.data && !query.isError ? (
        <DataTable
          data={preview ? all.slice(0, 4) : all}
          pageSize={preview ? undefined : 20}
          rowKey={(r) => r.id}
          emptyMessage="No cleaning tasks scheduled for this area today."
          columns={[
            {
              key: "time",
              header: "Time",
              sortValue: (r) => r.shiftStart,
              render: (r) =>
                site
                  ? formatInTimeZone(
                      r.shiftStart,
                      site.timezone,
                      language === "ur" ? "HH:mm" : "h:mm a",
                    )
                  : "—",
            },
            {
              key: "staff",
              header: "Assigned to",
              render: (r) => <TaskWorker task={r} />,
            },
            {
              key: "work",
              header: "Work status",
              render: (r) => (
                <OperationStatus
                  state={
                    r.staffSubmittedAt || r.status === "COMPLETED"
                      ? "PASSED"
                      : (r.status ?? undefined)
                  }
                  label={
                    r.staffSubmittedAt || r.status === "COMPLETED"
                      ? "Work submitted"
                      : r.status === "IN_PROGRESS"
                        ? "In progress"
                        : r.status === "MISSED" ||
                            r.status === "NOT_COMPLETED_INTIME"
                          ? "Overdue"
                          : r.status === "CANCELLED"
                            ? "Cancelled"
                            : "Not started"
                  }
                />
              ),
            },
            {
              key: "review",
              header: "Photo checks",
              render: (r) => (
                <OperationStatus
                  state={r.verificationState}
                  label={verificationLabel(r)}
                />
              ),
            },
            {
              key: "action",
              header: "Action",
              render: (r) => (
                <Button asChild variant="outline">
                  <Link to={"/verification/" + r.id}>
                    {t("Open task")}
                    <ArrowRight size={14} />
                  </Link>
                </Button>
              ),
            },
          ]}
        />
      ) : null}
    </section>
  );
}
