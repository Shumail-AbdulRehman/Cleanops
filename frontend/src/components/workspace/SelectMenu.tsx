import type { ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useLanguage } from "@/i18n/context";
import { cn } from "@/lib/utils";
import "./filter-controls.css";

export interface FilterOption {
  value: string;
  label: string;
  /** Set false for record data such as a location's name. */
  translateLabel?: boolean;
  disabled?: boolean;
  count?: number;
}

export interface SelectMenuProps {
  label: string;
  value: string;
  options: readonly FilterOption[];
  onChange: (value: string) => void;
  icon?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function SelectMenu({ label, value, options, onChange, icon, placeholder = label, disabled, className }: SelectMenuProps) {
  const { t, language } = useLanguage();
  const dir = language === "ur" ? "rtl" : "ltr";
  const optionLabel = (option: FilterOption) => option.translateLabel === false ? option.label : t(option.label);
  const selected = options.find(option => option.value === value);
  const currentLabel = selected ? optionLabel(selected) : t(placeholder);

  return (
    <DropdownMenu.Root dir={dir}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={cn("wx-filter-trigger", className)} disabled={disabled || options.length === 0}
          aria-label={`${t(label)}: ${currentLabel}`}>
          {icon && <span className="wx-filter-icon" aria-hidden="true">{icon}</span>}
          <bdi className="wx-filter-label">{currentLabel}</bdi>
          <ChevronDown className="wx-filter-chevron" aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <div className="workspace wx-filter-portal" dir={dir} lang={language === "ur" ? "ur-PK" : "en-PK"}>
          <DropdownMenu.Content className="wx-filter-menu" align="start" sideOffset={6} collisionPadding={12} loop aria-labelledby={undefined} aria-label={t(label)}>
            <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
              {options.map(option => (
                <DropdownMenu.RadioItem className="wx-filter-option" key={option.value} value={option.value} disabled={option.disabled}>
                  <bdi className="wx-filter-label">{optionLabel(option)}</bdi>
                  <DropdownMenu.ItemIndicator className="wx-filter-check"><Check aria-hidden="true" /></DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </div>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export default SelectMenu;
