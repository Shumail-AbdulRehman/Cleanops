import { useLanguage } from "@/i18n/context";
import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SurfaceCardProps {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export default function SurfaceCard({
  title,
  description,
  children,
  className,
  contentClassName,
}: SurfaceCardProps) {
  const { t } = useLanguage();
  return (
    <Card className={cn("surface-panel overflow-hidden", className)}>
      {(title || description) && (
        <CardHeader className="border-b border-border/60">
          {title && <CardTitle>{t(title)}</CardTitle>}
          {description && <CardDescription>{t(description)}</CardDescription>}
        </CardHeader>
      )}
      <CardContent
        className={cn(title || description ? "pt-6" : "pt-6", contentClassName)}
      >
        {children}
      </CardContent>
    </Card>
  );
}
