import { useId } from "react";
import { useLanguage } from "@/i18n/context";
import "./workspace-parts.css";

export interface MeterRowProps {
  /** Record name: preserved verbatim, including under Urdu. */
  name: string;
  figure: string | number;
  value: number | null;
  max?: number;
  tone?: "submitted" | "attendance";
  subline?: string;
  className?: string;
}

export function MeterRow({ name, figure, value, max = 100, tone = "submitted", subline, className = "" }: MeterRowProps) {
  const { t } = useLanguage();
  const labelId = useId();
  const known = value !== null && Number.isFinite(value) && Number.isFinite(max) && max > 0;
  const amount = known ? Math.min(max, Math.max(0, value)) : 0;

  return (
    <div className={`wx-meter-row wx-meter-row--${tone} ${className}`}>
      <div className="wx-meter-row__heading">
        <bdi id={labelId} className="wx-meter-row__name">{name}</bdi>
        <bdi className="wx-meter-row__figure">{known ? figure : "—"}</bdi>
      </div>
      <div
        className="wx-meter-row__track"
        role={known ? "meter" : "img"}
        aria-labelledby={known ? labelId : undefined}
        aria-label={known ? undefined : `${name}: ${t("Not recorded")}`}
        aria-valuemin={known ? 0 : undefined}
        aria-valuemax={known ? max : undefined}
        aria-valuenow={known ? amount : undefined}
        aria-valuetext={known ? String(figure) : undefined}
      >
        {known && <span style={{ inlineSize: `${(amount / max) * 100}%` }} />}
      </div>
      {subline && <div className="wx-meter-row__subline">{t(subline)}</div>}
    </div>
  );
}

export default MeterRow;
