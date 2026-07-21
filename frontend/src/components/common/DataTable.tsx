import { useLanguage } from "@/i18n/context";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import EmptyState from "./EmptyState";
import { cn } from "@/lib/utils";
import "../workspace/table-v6.css";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  sortValue?: (row: T) => string | number;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string | number;
  emptyIcon?: ReactNode;
  emptyMessage?: string;
  mobileRender?: (row: T) => ReactNode;
  onRowClick?: (row: T) => void;
  onRowHover?: (row: T) => void;
  className?: string;
  pageSize?: number;
  expandedRow?: (row: T) => ReactNode;
  /** Show every labelled cell as a card below 620px instead of legacy summaries. */
  mobileCards?: boolean;
  /** Controlled selection; null exposes every row as unselected. */
  selectedRowKey?: string | number | null;
}

export default function DataTable<T>({
  mobileRender,
  columns,
  data,
  rowKey,
  emptyIcon,
  emptyMessage = "No data found.",
  onRowClick,
  onRowHover,
  className,
  pageSize,
  expandedRow,
  mobileCards = false,
  selectedRowKey,
}: DataTableProps<T>) {
  const { t } = useLanguage();
  const [sort, setSort] = useState<{ key: string; direction: 1 | -1 } | null>(
    null,
  );
  const [page, setPage] = useState(1);
  const pages = pageSize ? Math.max(1, Math.ceil(data.length / pageSize)) : 1;
  const currentPage = Math.min(page, pages);
  const sorted = useMemo(() => {
    const column = columns.find((c) => c.key === sort?.key);
    if (!sort || !column?.sortValue) return data;
    const value = column.sortValue;
    return [...data].sort((a, b) => {
      const x = value(a),
        y = value(b);
      return (
        (typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y), undefined, { numeric: true })) *
        sort.direction
      );
    });
  }, [data, columns, sort]);
  const toggleSort = (key: string) => {
    setPage(1);
    setSort((old) =>
      old?.key === key
        ? old.direction === 1
          ? { key, direction: -1 }
          : null
        : { key, direction: 1 },
    );
  };
  const visible = pageSize
    ? sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : sorted;
  if (data.length === 0) {
    return <EmptyState icon={emptyIcon} message={emptyMessage} />;
  }
  const mobileSort = columns.some((c) => c.sortValue) ? (
    <label className={mobileCards ? "wx-card-sort" : "table-mobile-sort"}>
      {t("Sort by")}
      <select value={sort?.key ?? ""} onChange={(event) => {
        setPage(1);
        setSort(event.target.value ? { key: event.target.value, direction: 1 } : null);
      }}>
        <option value="">{t("Default order")}</option>
        {columns.filter(c => c.sortValue).map(c => <option key={c.key} value={c.key}>{t(c.header)}</option>)}
      </select>
    </label>
  ) : null;

  return (
    <>
      {!mobileCards ? <div className="grid gap-3 md:hidden">
        {mobileSort}
        {visible.map((row) => {
          const actions = columns.filter((col) =>
            ["actions", "action"].includes(col.key),
          );
          const summary = columns.filter(
            (col, index) =>
              index === 0 || ["status", "location"].includes(col.key),
          );
          const details = columns.filter(
            (col) => !summary.includes(col) && !actions.includes(col),
          );
          const field = (col: Column<T>) => (
            <div key={col.key} className="space-y-1">
              <p className="text-sm text-muted-foreground">{t(col.header)}</p>
              <div className="min-w-0 break-words">{col.render(row)}</div>
            </div>
          );
          return (
            <article
              key={rowKey(row)}
              className="record-summary"
              aria-current={rowKey(row) === selectedRowKey ? "true" : undefined}
              onMouseEnter={() => onRowHover?.(row)}
            >
              {mobileRender ? (
                mobileRender(row)
              ) : (
                <>
                  {summary.map(field)}
                  {details.length ? (
                    <details>
                      <summary className="min-h-12 cursor-pointer font-semibold text-primary">
                        {t("Show details")}
                      </summary>
                      <div className="grid gap-4 py-3">
                        {details.map(field)}
                      </div>
                    </details>
                  ) : null}
                  {actions.map(field)}
                  {expandedRow?.(row)}
                  {onRowClick ? (
                    <Button variant="outline" onClick={() => onRowClick(row)}>
                      {t("Open details")}
                    </Button>
                  ) : null}
                </>
              )}
            </article>
          );
        })}
      </div> : null}
      {mobileCards ? mobileSort : null}
      <div
        role="region"
        aria-label={t(columns[0]?.header ?? "Records") + " " + t("table")}
        tabIndex={0}
        className={cn(
          "data-table overflow-x-auto rounded-xl border border-border bg-card",
          "wx-data-table",
          mobileCards ? "wx-data-table-cards" : "hidden md:block",
          className,
        )}
      >
        <table role="table" className="w-full text-sm">
          <thead role="rowgroup">
            <tr role="row" className="border-b border-border/70 bg-muted/60">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  role="columnheader"
                  aria-label={mobileCards ? t(col.header) : undefined}
                  aria-sort={
                    col.sortValue
                      ? sort?.key === col.key
                        ? sort.direction === 1
                          ? "ascending"
                          : "descending"
                        : "none"
                      : undefined
                  }
                  className={`px-5 py-3 text-start text-sm font-medium text-muted-foreground ${col.className ?? ""}`}
                >
                  {col.sortValue ? (
                    <button
                      type="button"
                      className="table-sort wx-table-sort"
                      onClick={() => toggleSort(col.key)}
                    >
                      {t(col.header)}
                      {sort?.key === col.key ? (
                        sort.direction === 1 ? (
                          <ArrowUp size={14} />
                        ) : (
                          <ArrowDown size={14} />
                        )
                      ) : (
                        <ArrowUpDown size={14} />
                      )}
                    </button>
                  ) : (
                    t(col.header)
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup" className="divide-y divide-border/60">
            {visible.map((row) => (
              <Fragment key={rowKey(row)}>
                <tr
                  role="row"
                  aria-selected={selectedRowKey === undefined ? undefined : rowKey(row) === selectedRowKey}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={(event) => {
                    if (
                      onRowClick &&
                      event.target === event.currentTarget &&
                      (event.key === "Enter" || event.key === " ")
                    ) {
                      event.preventDefault();
                      onRowClick(row);
                    }
                  }}
                  onClick={(event) => {
                    const interactive = (event.target as Element).closest(
                      'a, button, input, select, textarea, label, summary, [tabindex], [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="menuitem"]',
                    );
                    if (!interactive || interactive === event.currentTarget)
                      onRowClick?.(row);
                  }}
                  onMouseEnter={() => onRowHover?.(row)}
                  className={`wx-table-row transition-colors hover:bg-muted/40 ${
                    onRowClick ? "cursor-pointer" : ""
                  }`}
                >
                  {columns.map((col) => (
                    <td
                      role="cell"
                      key={col.key}
                      className={`px-5 py-4 text-muted-foreground ${col.className ?? ""}`}
                    >
                      {mobileCards ? <span className="wx-table-cell-label" aria-hidden="true">{t(col.header)}</span> : null}
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
                {expandedRow?.(row) ? (
                  <tr role="row" className="table-expanded-row wx-table-expanded-row">
                    <td role="cell" colSpan={columns.length}>{expandedRow(row)}</td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {pageSize && data.length > pageSize ? (
        <nav className="ops-pagination wx-pagination" aria-label={t("Pagination")}>
          <p>
            {t("{from}–{to} of {total}", {
              from: (currentPage - 1) * pageSize + 1,
              to: Math.min(currentPage * pageSize, data.length),
              total: data.length,
            })}
          </p>
          <div>
            <Button
              variant="outline"
              type="button"
              className="wx-pagination-button"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
            >
              {t("Previous")}
            </Button>
            <span aria-live="polite">
              {t("Page {page} of {total}", { page: currentPage, total: pages })}
            </span>
            <Button
              variant="outline"
              type="button"
              className="wx-pagination-button"
              disabled={currentPage >= pages}
              onClick={() => setPage(currentPage + 1)}
            >
              {t("Next")}
            </Button>
          </div>
        </nav>
      ) : null}
    </>
  );
}
