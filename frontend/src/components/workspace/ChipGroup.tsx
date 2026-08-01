import { useLanguage } from "@/i18n/context";
import { cn } from "@/lib/utils";
import type { FilterOption } from "./SelectMenu";
import "./filter-controls.css";

export interface ChipGroupProps {
  label: string;
  value: string;
  options: readonly FilterOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export function ChipGroup({ label, value, options, onChange, disabled, className }: ChipGroupProps) {
  const { t, language } = useLanguage();
  return (
    <div className={cn("wx-chip-group", className)} role="group" aria-label={t(label)} dir={language === "ur" ? "rtl" : "ltr"}>
      {options.map(option => (
        <button type="button" className="wx-filter-chip" key={option.value} aria-pressed={value === option.value}
          disabled={disabled || option.disabled} onClick={() => onChange(option.value)}>
          <bdi className="wx-filter-label">{option.translateLabel === false ? option.label : t(option.label)}</bdi>
          {option.count !== undefined && <span className="wx-filter-count">{option.count.toLocaleString(language === "ur" ? "ur-PK" : "en-PK")}</span>}
        </button>
      ))}
    </div>
  );
}

export default ChipGroup;
