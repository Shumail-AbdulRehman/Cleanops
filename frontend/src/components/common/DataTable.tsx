import type { ReactNode } from "react";
import EmptyState from "./EmptyState";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string | number;
  emptyIcon?: ReactNode;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  onRowHover?: (row: T) => void;
  className?: string;
}

export default function DataTable<T>({
  columns,
  data,
  rowKey,
  emptyIcon,
  emptyMessage = "No data found.",
  onRowClick,
  onRowHover,
  className,
}: DataTableProps<T>) {
  if (data.length === 0) {
    return <EmptyState icon={emptyIcon} message={emptyMessage} />;
  }

  return (
    <div className={cn("overflow-x-auto rounded-3xl border border-border/70 bg-card/95 shadow-[0_20px_60px_-36px_rgba(15,23,42,0.35)]", className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/70 bg-muted/60">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground ${col.className ?? ""}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {data.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={() => onRowClick?.(row)}
              onMouseEnter={() => onRowHover?.(row)}
              className={`transition-colors hover:bg-muted/40 ${
                onRowClick ? "cursor-pointer" : ""
              }`}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-5 py-4 text-muted-foreground ${col.className ?? ""}`}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
