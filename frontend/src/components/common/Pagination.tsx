import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/context";
import "../workspace/table-v6.css";
export default function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPage,
  onSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPage: (value: number) => void;
  onSize: (value: number) => void;
}) {
  const { t } = useLanguage();
  return (
    <nav className="ops-pagination wx-pagination" aria-label={t("Pagination")}>
      <p>
        {t("{from}–{to} of {total}", {
          from: total ? (page - 1) * pageSize + 1 : 0,
          to: Math.min(page * pageSize, total),
          total,
        })}
      </p>
      <label>
        {t("Per page")}
        <select
          aria-label={t("Per page")}
          value={pageSize}
          onChange={(e) => onSize(Number(e.target.value))}
        >
          <option value="20">20</option>
          <option value="50">50</option>
        </select>
      </label>
      <div>
        <Button
          variant="outline"
          type="button"
          className="wx-pagination-button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          {t("Previous")}
        </Button>
        <span aria-live="polite">
          {t("Page {page} of {total}", { page, total: totalPages })}
        </span>
        <Button
          variant="outline"
          type="button"
          className="wx-pagination-button"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          {t("Next")}
        </Button>
      </div>
    </nav>
  );
}
