import { useId, useRef, type ComponentProps } from "react";
import { Search, X } from "lucide-react";
import { useLanguage } from "@/i18n/context";
import { cn } from "@/lib/utils";
import "./filter-controls.css";

export interface FindFieldProps extends Omit<ComponentProps<"input">, "value" | "defaultValue" | "onChange" | "type" | "size" | "aria-label"> {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export function FindField({ label, value, onChange, className, placeholder, id, disabled, readOnly, ...props }: FindFieldProps) {
  const { t } = useLanguage();
  const generatedId = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={cn("wx-find-field", className)}>
      <Search className="wx-filter-icon" aria-hidden="true" />
      <input {...props} ref={input} id={id ?? generatedId} type="search" aria-label={t(label)}
        placeholder={t(placeholder ?? label)} value={value} disabled={disabled} readOnly={readOnly}
        onChange={event => onChange(event.target.value)} />
      {value !== "" && <button type="button" className="wx-filter-icon-button" aria-label={t("Clear search")}
        disabled={disabled || readOnly} onClick={() => { onChange(""); input.current?.focus(); }}>
        <X aria-hidden="true" />
      </button>}
    </div>
  );
}

export default FindField;
