import StatusBadge from "@/components/common/StatusBadge";
import { useLanguage } from "@/i18n/context";
import "./workspace-parts.css";

export type StatusPillTone = "neutral" | "ok" | "progress" | "attention" | "bad";

export interface StatusPillProps {
  status?: string | null;
  children?: string;
  tone?: StatusPillTone;
  className?: string;
}

/** Explicit copy for new states, or the existing StatusBadge vocabulary. */
export function StatusPill({ status, children, tone = "neutral", className = "" }: StatusPillProps) {
  const { t } = useLanguage();
  return (
    <span className={`wx-status-pill wx-status-pill--${tone} ${className}`}>
      {children?.trim() ? t(children) : (
        <StatusBadge status={status?.trim() || null} className="wx-status-pill__label" />
      )}
    </span>
  );
}

export default StatusPill;
