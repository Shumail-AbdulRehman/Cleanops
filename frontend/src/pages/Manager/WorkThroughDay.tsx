import { useId } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TriangleAlert } from "lucide-react";
import { useLanguage } from "@/i18n/context";
import StatusPill from "@/components/workspace/StatusPill";
import OperationsState from "./OperationsState";
import { hourlyProgress, type HourlyProgressInput } from "./hourlyProgress";
import "./today-charts-v6.css";

export interface WorkThroughDayProps extends HourlyProgressInput {
  loading?: boolean;
  error?: unknown;
  retry?: () => void;
}

/** Snapshot-only presentation. The caller chooses the display timezone. */
export function WorkThroughDay({ hourly, asOf, date, timezone, loading, error, retry }: WorkThroughDayProps) {
  const { t, language } = useLanguage();
  const titleId = useId();
  const summaryId = useId();
  const { points, currentHour, current, behind } = hourlyProgress({ hourly, asOf, date, timezone });
  const number = (value: number) => value.toLocaleString(language === "ur" ? "ur-PK" : "en-PK");
  // Hours already represent local clock fields, so UTC is only a formatting container.
  const hour = (value: number) => new Intl.DateTimeFormat(language === "ur" ? "ur-PK" : "en-PK", {
    timeZone: "UTC", hour: "numeric", minute: "2-digit",
  }).format(new Date(Date.UTC(2000, 0, 1, value)));
  const chartPoints = points.map(point => ({
    ...point,
    submitted: currentHour !== null && point.hour > currentHour ? null : point.submitted,
  }));
  const last = chartPoints.at(-1);
  const observed = chartPoints.findLast(point => point.submitted !== null);
  const summaryPoint = currentHour !== null ? current : last;
  const summary = summaryPoint && last ? t(
    "By {time}, {due} tasks were due and {submitted} were submitted. {total} tasks are due by the end of the day.",
    { time: hour(currentHour ?? summaryPoint.hour), due: number(summaryPoint.due), submitted: summaryPoint.submitted === null ? t("Not recorded") : number(summaryPoint.submitted), total: number(last.due) },
  ) : t("No data");
  const minHour = Math.min(chartPoints[0]?.hour ?? 0, currentHour ?? 23);
  const maxHour = Math.max(last?.hour ?? 23, currentHour ?? 0);


  return (
    <section className="wx-today-chart wx-today-chart--work" aria-labelledby={titleId}>
      <div className="wx-today-chart__heading">
        <div><h2 id={titleId}>{t("Work through the day")}</h2><p>{t("Tasks due so far, compared with tasks submitted.")}</p></div>
        {behind > 0 && <div className="wx-today-chart__behind"><TriangleAlert size={14} aria-hidden="true" /><StatusPill tone="attention">{t("{count} tasks behind", { count: number(behind) })}</StatusPill></div>}
      </div>
      {(error || (loading && !points.length)) ? <OperationsState loading={loading && !points.length} error={error} retry={retry} skeleton="panel" /> : null}
      {last ? <>
        <ul className="wx-today-chart__legend" aria-label={t("Work status")}>
          <li><span className="wx-today-chart__key wx-today-chart__key--submitted" aria-hidden="true" />{t("Work submitted")}</li>
          <li><span className="wx-today-chart__key wx-today-chart__key--due" aria-hidden="true" />{t("Due by this time")}</li>
        </ul>
        <p id={summaryId} className="wx-today-chart__sr">{summary}</p>
        <div className="wx-today-chart__plot" dir="ltr" role="img" aria-label={t("Work through the day")} aria-describedby={summaryId}>
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 260 }}>
            <LineChart data={chartPoints} margin={{ top: 36, right: 40, bottom: 18, left: -16 }} accessibilityLayer>
              <CartesianGrid vertical={false} stroke="var(--wx-line)" />
              <XAxis type="number" dataKey="hour" domain={[minHour, maxHour]} allowDecimals={false} tickFormatter={hour} axisLine={false} tickLine={false} minTickGap={24} tick={{ fill: "var(--wx-muted)", fontSize: 12 }} dy={10} padding={{ left: 8, right: 8 }} />
              <YAxis domain={[0, "auto"]} allowDecimals={false} tickFormatter={number} axisLine={false} tickLine={false} tick={{ fill: "var(--wx-muted)", fontSize: 12 }} />
              <Tooltip isAnimationActive={false} filterNull={false} content={({ active, payload, label }) => active && payload?.length ? <div className="wx-today-chart__tooltip" dir={language === "ur" ? "rtl" : "ltr"}>
                <strong><bdi>{hour(Number(label))}</bdi></strong>
                <dl>{payload.map(series => <div key={String(series.dataKey)}><dt>{series.name}</dt><dd><bdi>{series.value == null ? t("Not recorded") : number(Number(series.value))}</bdi></dd></div>)}</dl>
              </div> : null} />
              <Line dataKey="due" name={t("Due by this time")} type="linear" stroke="var(--wx-faint)" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={false} />
              <Line dataKey="submitted" name={t("Work submitted")} type="linear" stroke="var(--wx-blue)" strokeWidth={2.5} dot={chartPoints.length === 1} connectNulls={false} isAnimationActive={false} />
              {currentHour !== null && <ReferenceLine x={currentHour} stroke="var(--wx-line-strong)" strokeDasharray="3 4" label={{ value: t("Now"), position: "top", dy: -18, fill: "var(--wx-ink)", fontSize: 12 }} />}
              <ReferenceDot x={last.hour} y={last.due} r={3} fill="var(--wx-faint)" stroke="var(--wx-surface)" label={{ value: number(last.due), position: "right", dy: -8, fill: "var(--wx-muted)", fontSize: 12, offset: 10 }} />
              {observed && <ReferenceDot x={observed.hour} y={observed.submitted!} r={4} fill="var(--wx-blue)" stroke="var(--wx-surface)" label={{ value: number(observed.submitted!), position: "right", dy: 8, fill: "var(--wx-blue)", fontSize: 12, offset: 10 }} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <details className="wx-today-chart__figures">
          <summary>{t("View hourly figures")}</summary>
          <table><caption className="wx-today-chart__sr">{t("View hourly figures")}</caption>
            <thead><tr><th scope="col">{t("Time")}</th><th scope="col">{t("Due by this time")}</th><th scope="col">{t("Work submitted")}</th></tr></thead>
            <tbody>{chartPoints.map(point => <tr key={point.hour}><th scope="row"><bdi>{hour(point.hour)}</bdi></th><td><bdi>{number(point.due)}</bdi></td><td><bdi>{point.submitted === null ? t("Not recorded") : number(point.submitted)}</bdi></td></tr>)}</tbody>
          </table>
        </details>
      </> : !loading && !error ? <div className="wx-today-chart__empty"><p>{t("Hourly figures are not available for this day.")}</p><p>{t("View daily records for task details.")}</p></div> : null}
    </section>
  );
}

export default WorkThroughDay;
