import { useLanguage } from "@/i18n/context";
import { Badge } from "@/components/ui/badge";

const COLORS: Record<string, string> = {
  PENDING: "border-slate-200 bg-slate-100 text-slate-700",
  IN_PROGRESS: "border-amber-200 bg-amber-100 text-amber-700",
  COMPLETED: "border-emerald-200 bg-emerald-100 text-emerald-700",
  MISSED: "border-red-200 bg-red-100 text-red-700",
  NOT_COMPLETED_INTIME: "border-orange-200 bg-orange-100 text-orange-700",
  CANCELLED: "border-slate-200 bg-slate-100 text-slate-600",

  CHECKED_OUT: "border-emerald-200 bg-emerald-100 text-emerald-700",
  CHECKED_IN: "border-sky-200 bg-sky-100 text-sky-700",
  LATE: "border-amber-200 bg-amber-100 text-amber-700",
  MISSED_CHECKOUT: "border-rose-200 bg-rose-100 text-rose-700",
  ABSENT: "border-red-200 bg-red-100 text-red-700",
  SHIFT_NOT_STARTED: "border-slate-200 bg-slate-100 text-slate-700",
  NO_RECORD_TODAY: "border-slate-200 bg-slate-100 text-slate-600",

  ACTIVE: "border-emerald-200 bg-emerald-100 text-emerald-700",
  INACTIVE: "border-slate-200 bg-slate-100 text-slate-600",
  DAILY: "border-primary/20 bg-primary/10 text-primary",
  ONCE: "border-slate-200 bg-slate-100 text-slate-700",
};

interface StatusBadgeProps {
  status?: string | null;
  className?: string;
}

export default function StatusBadge({
  status,
  className = "",
}: StatusBadgeProps) {
  const { t } = useLanguage();
  const safeStatus = status ?? "UNKNOWN";
  const color = COLORS[safeStatus] ?? "bg-gray-100 text-gray-600";
  const words = safeStatus.replace(/_/g, " ").toLowerCase();
  const label =
    (
      {
        PENDING: "Not started",
        COMPLETED: "Completed",
        NOT_COMPLETED_INTIME: "Overdue work",
        CHECKED_IN: "Checked in",
        CHECKED_OUT: "Checked out",
        MISSED_CHECKOUT: "Missed Checkout",
        ABSENT: "Not checked in",
        SHIFT_NOT_STARTED: "Upcoming Shift",
        NO_RECORD_TODAY: "Not recorded",
      } as Record<string, string>
    )[safeStatus] ?? words.charAt(0).toUpperCase() + words.slice(1);

  return (
    <Badge
      variant="outline"
      className={`whitespace-nowrap border ${color} ${className}`}
    >
      {t(label)}
    </Badge>
  );
}
