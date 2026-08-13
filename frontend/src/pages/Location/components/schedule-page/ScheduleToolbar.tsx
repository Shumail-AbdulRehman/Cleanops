import { ListFilter, X } from "lucide-react";
import { useState } from "react";

import { ChipGroup } from "@/components/workspace/ChipGroup";
import { FindField } from "@/components/workspace/FindField";
import { SegmentedControl } from "@/components/workspace/SegmentedControl";
import { SelectMenu } from "@/components/workspace/SelectMenu";
import { SidePanel } from "@/components/workspace/SidePanel";
import { useLanguage } from "@/i18n/context";
import { WEEKDAY_LABELS, type Weekday } from "@/lib/workDays";
import type { ScheduleFilters, ScheduleGroupBy, ScheduleList } from "../../schedulePageModel";
import type { LocationStaff } from "../../types";
import "./ScheduleToolbar.css";

type ScheduleView = "list" | "week";
type ScheduleChip = NonNullable<ScheduleFilters["chip"]>;
type NamedOption = { id: number; name: string };

export interface ScheduleToolbarProps {
  view: ScheduleView;
  search: string;
  staffFilter: ScheduleFilters["staff"];
  areaFilter: ScheduleFilters["areaId"];
  groupBy: ScheduleGroupBy;
  chip: ScheduleChip;
  selectedWeekday: Weekday | null;
  staffOptions: readonly Pick<LocationStaff, "id" | "name" | "isActive">[];
  areaOptions: readonly NamedOption[];
  counts: ScheduleList["counts"];
  onViewChange: (view: ScheduleView) => void;
  onSearchChange: (search: string) => void;
  onStaffFilterChange: (staff: ScheduleFilters["staff"]) => void;
  onAreaFilterChange: (area: ScheduleFilters["areaId"]) => void;
  onGroupByChange: (group: ScheduleGroupBy) => void;
  onChipChange: (chip: ScheduleChip) => void;
  onClearDay: () => void;
}

const views = [
  { value: "list", label: "List" },
  { value: "week", label: "Week" },
];

const groups = [
  { value: "time", label: "Group: Time of day" },
  { value: "area", label: "Group: Area" },
  { value: "staff", label: "Group: Staff" },
];

function recordOption({ id, name }: NamedOption) {
  return { value: String(id), label: name, translateLabel: false };
}

export function ScheduleToolbar({
  view, search, staffFilter, areaFilter, groupBy, chip, selectedWeekday,
  staffOptions, areaOptions, counts, onViewChange, onSearchChange,
  onStaffFilterChange, onAreaFilterChange, onGroupByChange, onChipChange, onClearDay,
}: ScheduleToolbarProps) {
  const { language, t } = useLanguage();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const dayLabel = selectedWeekday && t("Runs on {day}", {
    day: t(WEEKDAY_LABELS[selectedWeekday].short),
  });

  const selects = (
    <div className="schedule-toolbar__selects">
      <SelectMenu
        label="Staff"
        value={staffFilter === undefined ? "all" : String(staffFilter)}
        options={[
          { value: "all", label: "All staff" },
          ...staffOptions.filter(({ isActive }) => isActive).map(recordOption),
          { value: "unassigned", label: "Unassigned" },
        ]}
        onChange={value => onStaffFilterChange(value === "all" ? undefined : value === "unassigned" ? value : Number(value))}
      />
      <SelectMenu
        label="Area"
        value={areaFilter === undefined ? "all" : String(areaFilter)}
        options={[{ value: "all", label: "All areas" }, ...areaOptions.map(recordOption)]}
        onChange={value => onAreaFilterChange(value === "all" ? undefined : Number(value))}
      />
      {view === "list" && (
        <SelectMenu label="Schedule" value={groupBy} options={groups} onChange={value => {
          if (value === "time" || value === "area" || value === "staff") onGroupByChange(value);
        }} />
      )}
    </div>
  );

  const chips = view === "list" && (
    <div className="schedule-toolbar__chips">
      <ChipGroup
        label="Filters"
        value={chip}
        options={[
          { value: "all", label: "All", count: counts.all },
          { value: "needsAttention", label: "Needs attention", count: counts.needsAttention },
          ...(counts.inactive > 0 ? [{ value: "inactive", label: "Inactive", count: counts.inactive }] : []),
        ]}
        onChange={value => {
          if (value === "all" || value === "needsAttention" || value === "inactive") onChipChange(value);
        }}
      />
      {dayLabel && (
        <button type="button" className="wx-filter-chip" aria-pressed="true" onClick={onClearDay}>
          <bdi>{dayLabel}</bdi>
          <X className="wx-filter-icon" aria-hidden="true" />
        </button>
      )}
    </div>
  );

  return (
    <div className="schedule-toolbar" dir={language === "ur" ? "rtl" : "ltr"} lang={language === "ur" ? "ur-PK" : "en-PK"}>
      <div className="schedule-toolbar__row">
        <SegmentedControl label="View" value={view} options={views} onChange={value => {
          if (value === "list" || value === "week") onViewChange(value);
        }} />
        <button
          type="button"
          className="wx-filter-trigger schedule-toolbar__open-filters"
          aria-haspopup="dialog"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen(true)}
        >
          <ListFilter className="wx-filter-icon" aria-hidden="true" />
          {t("Filters")}
        </button>
        <FindField
          className="schedule-toolbar__search"
          label="Search schedules, areas or staff"
          value={search}
          onChange={onSearchChange}
        />
        <div className="schedule-toolbar__desktop">{selects}</div>
      </div>
      {chips && <div className="schedule-toolbar__desktop">{chips}</div>}
      <SidePanel title="Filters" open={filtersOpen} onOpenChange={setFiltersOpen}>
        <div className="schedule-toolbar__sheet">
          {selects}
          {chips}
        </div>
      </SidePanel>
    </div>
  );
}
