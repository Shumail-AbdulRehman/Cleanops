import { useLanguage } from "@/i18n/context";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import "./loading-skeleton.css";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  tools?: ReactNode;
  className?: string;
}

export default function PageHeader({
  title,
  subtitle,
  action,
  tools,
  className,
}: PageHeaderProps) {
  const { t } = useLanguage();
  return (
    <div
      className={cn(
        "page-header wx-page-header flex items-start justify-between gap-4 flex-wrap",
        className,
      )}
    >
      <div className="page-header-copy wx-page-header__copy">
        <h1 className="wx-page-header__title text-3xl font-semibold tracking-tight text-foreground">
          {t(title)}
        </h1>
        {subtitle && (
          <p className="wx-page-header__subtitle mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {t(subtitle)}
          </p>
        )}
      </div>
      {(tools || action) && <div className="page-header-actions wx-page-header__tools">{tools}{action}</div>}
    </div>
  );
}
