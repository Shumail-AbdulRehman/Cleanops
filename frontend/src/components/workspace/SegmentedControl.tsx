import { useLanguage } from "@/i18n/context";
import { cn } from "@/lib/utils";
import type { ChipGroupProps } from "./ChipGroup";
import "./filter-controls.css";

export type SegmentedControlProps = ChipGroupProps;

export function SegmentedControl({ label, value, options, onChange, disabled, className }: SegmentedControlProps) {
  const { t, language } = useLanguage();
  return (
    <div className={cn("wx-segmented-control", className)} role="group" aria-label={t(label)} dir={language === "ur" ? "rtl" : "ltr"}>
      {options.map(option => (
        <button type="button" className="wx-filter-segment" key={option.value} aria-pressed={value === option.value}
          disabled={disabled || option.disabled} onClick={() => onChange(option.value)}>
          <bdi className="wx-filter-label">{option.translateLabel === false ? option.label : t(option.label)}</bdi>
        </button>
      ))}
    </div>
  );
}

export default SegmentedControl;
