import { useLanguage } from "@/i18n/context";
import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import "./loading-skeleton.css";

interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  message?: string;
  action?: ReactNode;
}

export default function EmptyState({
  icon,
  title = "Nothing here yet.",
  message,
  action,
}: EmptyStateProps) {
  const { t } = useLanguage();
  return (
    <div className="workspace-empty wx-page-state flex flex-col items-center justify-center px-6 text-center">
      <div className="wx-page-state__icon mb-4 rounded-2xl bg-muted p-4 text-muted-foreground" aria-hidden="true">
        {icon ?? <Inbox className="h-12 w-12" />}
      </div>
      <h2 className="wx-page-state__title">{t(title)}</h2>
      {message && <p className="wx-page-state__message text-sm text-muted-foreground">{t(message)}</p>}
      {action && <div className="wx-page-state__actions mt-4">{action}</div>}
    </div>
  );
}
