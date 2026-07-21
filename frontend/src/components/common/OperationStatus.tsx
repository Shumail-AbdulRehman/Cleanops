import { useLanguage } from "@/i18n/context";
export default function OperationStatus({
  state,
  label,
}: {
  state?: string;
  label: string;
}) {
  const { t } = useLanguage();
  const tone = ["MISSED", "NOT_COMPLETED_INTIME", "ABSENT"].includes(
    state ?? "",
  )
    ? "danger"
    : ["IN_PROGRESS", "PROCESSING", "CAPTURING", "SUBMITTED"].includes(state ?? "")
      ? "progress"
      : [
            "PASSED",
            "VERIFIED",
            "MANAGER_ACCEPTED",
            "VERIFIED_COMPLETE",
            "CHECKED_IN",
            "CHECKED_OUT",
          ].includes(state ?? "")
        ? "success"
        : [
              "MISSING",
              "REVIEW_REQUIRED",
              "NEEDS_REVIEW",
              "PRIVACY_HOLD",
              "MANAGER_REVIEW",
              "LATE",
              "MISSED_CHECKOUT",
              "OPEN",
              "RECAPTURE_REQUIRED",
              "CLEANING_REQUIRED",
              "MISSED",
              "NOT_COMPLETED_INTIME",
              "ABSENT",
            ].includes(state ?? "")
          ? "attention"
          : "neutral";
  return (
    <span className="ops-status" data-tone={tone}>
      {t(label)}
    </span>
  );
}
