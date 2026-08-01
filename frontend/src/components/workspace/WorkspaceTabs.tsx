import type { ReactNode } from "react";
import { Tabs } from "radix-ui";
import { useLanguage } from "@/i18n/context";
import { cn } from "@/lib/utils";
import "./table-v6.css";

export interface WorkspaceTab {
  value: string;
  label: string;
  count?: number;
  disabled?: boolean;
}

export interface WorkspaceTabsProps {
  label: string;
  value: string;
  tabs: WorkspaceTab[];
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** The caller owns the value (including URL state) and each panel's data. */
export function WorkspaceTabs({ label, value, tabs, onChange, children, disabled, className }: WorkspaceTabsProps) {
  const { t, language } = useLanguage();
  const direction = language === "ur" ? "rtl" : "ltr";
  const numbers = new Intl.NumberFormat(language === "ur" ? "ur-PK" : "en-PK");
  return (
    <Tabs.Root className={cn("wx-tabs", className)} value={value} onValueChange={onChange} dir={direction}>
      <Tabs.List className="wx-tab-list" aria-label={t(label)}>
        {tabs.map(tab => (
          <Tabs.Trigger className="wx-tab" key={tab.value} value={tab.value} disabled={disabled || tab.disabled}
            aria-label={tab.count === undefined ? t(tab.label) : `${t(tab.label)} ${numbers.format(tab.count)}`}>
            <span>{t(tab.label)}</span>
            {tab.count !== undefined ? <span className="wx-tab-count">{numbers.format(tab.count)}</span> : null}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {children}
    </Tabs.Root>
  );
}

export interface WorkspaceTabPanelProps {
  value: string;
  children: ReactNode;
  className?: string;
}

/** Keep panel naming and tab/panel IDs paired through the same Radix root. */
export function WorkspaceTabPanel({ value, children, className }: WorkspaceTabPanelProps) {
  return <Tabs.Content className={cn("wx-tab-panel", className)} value={value}>{children}</Tabs.Content>;
}

export default WorkspaceTabs;
