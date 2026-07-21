import { useSelector } from "react-redux";
import type { RootState } from "@/store/store";
import { useSearchParams } from "react-router-dom";
import { useLanguage } from "@/i18n/context";
import { MapPin } from "lucide-react";
import SelectMenu from "@/components/workspace/SelectMenu";
import DateMenu from "@/components/workspace/DateMenu";
import type { LocationScope } from "@/pages/Manager/operations";
export default function ScopeFilters({
  locations,
  localDate,
}: {
  locations: LocationScope[];
  localDate?: string;
}) {
  const { t } = useLanguage();
  const role = useSelector((s: RootState) => s.auth.user?.role);
  const [params, setParams] = useSearchParams();
  const date = params.get("date") || "today";
  const now = new Date();
  const maximumDate = localDate ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  function update(k: string, v: string) {
    setParams((old) => {
      const next = new URLSearchParams(old);
      if (v) next.set(k, v);
      else next.delete(k);
      next.delete("page");
      next.delete("taskId");
      return next;
    });
  }
  return (
    <div className="wx-scope flex max-w-full min-w-0 flex-wrap items-center gap-2">
      <SelectMenu
        label="Location"
        icon={<MapPin />}
        value={params.get("locationId") ?? ""}
        options={[
          { value: "", label: role === "ADMIN" ? "All locations" : "My assigned locations" },
          ...locations.map(location => ({ value: String(location.id), label: location.name, translateLabel: false })),
        ]}
        onChange={value => update("locationId", value)}
      />
      <DateMenu
        value={date}
        localDate={localDate}
        maxDate={maximumDate}
        onChange={value => update("date", value || "today")}
      />
      {date === "today" ? (
        <span className="text-[length:var(--wx-small-size-max)] text-[color:var(--wx-muted)]">{t("Today in each location")}</span>
      ) : (
        <button type="button" className="wx-filter-trigger" onClick={() => update("date", "today")}>
          {t("Back to today")}
        </button>
      )}
    </div>
  );
}
