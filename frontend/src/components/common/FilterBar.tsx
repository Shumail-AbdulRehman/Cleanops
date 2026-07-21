import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface FilterBarProps {
  children: ReactNode;
  className?: string;
}

export default function FilterBar({ children, className }: FilterBarProps) {
  return (
    <div
      className={cn(
        "workspace-filterbar grid gap-3 rounded-xl border border-border/70 bg-card/95 p-4  sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_auto_auto_auto]",
        className,
      )}
    >
      {children}
    </div>
  );
}
