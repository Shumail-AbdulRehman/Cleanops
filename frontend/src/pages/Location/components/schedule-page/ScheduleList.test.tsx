import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageContext } from "@/i18n/context";
import { translate } from "@/i18n/translations";
import type { ScheduleGroup, ScheduleRow } from "../../schedulePageModel";
import { ScheduleList, type ScheduleListProps } from "./ScheduleList";

afterEach(cleanup);

const morningRow: ScheduleRow = {
  id: 1,
  title: "Morning washroom reset",
  areaId: 4,
  areaName: "A block washroom",
  fixturesChoice: "ALL",
  worker: { id: 8, name: "Bilal Ahmed", workDays: null, shiftText: null },
  weekdays: ["MON", "TUE", "WED", "THU", "FRI", "SAT"],
  recurringType: "DAILY",
  effectiveDate: "2026-11-16",
  onceDate: null,
  futureStartDate: null,
  inactive: false,
  needsReview: false,
  start: "06:00",
  end: "06:45",
  duration: { hours: 0, minutes: 45 },
  overnight: false,
};

const openRow: ScheduleRow = { ...morningRow, id: 2, title: "Lobby floor", worker: null };
const morning: ScheduleGroup = {
  key: "morning",
  labelKey: "Morning",
  label: null,
  rangeText: "06:00–11:59",
  rows: [morningRow, openRow],
};

function renderList(overrides: Partial<ScheduleListProps> = {}) {
  const props = {
    groups: [morning],
    selectedId: null,
    onOpen: vi.fn(),
    onClearFilters: vi.fn(),
    ...overrides,
  } satisfies ScheduleListProps;
  render(<ScheduleList {...props} />);
  return props;
}

describe("ScheduleList", () => {
  it("renders supplied group labels, ranges and counts", () => {
    const areaGroup: ScheduleGroup = {
      key: "area:4",
      labelKey: null,
      label: "A block washroom",
      rangeText: null,
      rows: [{ ...morningRow, id: 3, title: "Restock fixtures" }],
    };
    renderList({ groups: [morning, areaGroup] });

    const time = within(screen.getByRole("region", { name: "Morning" }));
    const area = within(screen.getByRole("region", { name: "A block washroom" }));
    expect(time.getByRole("heading", { name: "Morning" })).toBeVisible();
    expect(time.getByText("06:00–11:59")).toBeVisible();
    expect(time.getByText("2")).toBeVisible();
    expect(within(time.getByRole("list")).getAllByRole("listitem")).toHaveLength(2);
    expect(area.getByRole("heading", { name: "A block washroom" })).toBeVisible();
    expect(area.getByText("1")).toBeVisible();
  });

  it("shows the time range, duration, day text, title, area, fixtures and worker in one row button", () => {
    renderList();

    const row = within(screen.getByRole("button", { name: /Morning washroom reset/ }));
    expect(row.getByText("06:00–06:45")).toBeVisible();
    expect(row.getByText("45 min")).toBeVisible();
    expect(row.getByText("Mon–Sat")).toBeVisible();
    expect(row.getByText("Morning washroom reset")).toBeVisible();
    expect(row.getByText("A block washroom")).toBeVisible();
    expect(row.getByText(/All active items/)).toBeVisible();
    expect(row.getByText("Bilal Ahmed")).toBeVisible();
  });

  it("labels an open row Unassigned once", () => {
    renderList();

    const row = within(screen.getByRole("button", { name: /Lobby floor/ }));
    expect(row.getByText("Unassigned")).toBeVisible();
    expect(row.queryByText("Needs a worker")).not.toBeInTheDocument();
  });

  it("shows review, inactive, future start and one-time tags", () => {
    renderList({ groups: [{ ...morning, rows: [
      { ...morningRow, needsReview: true, inactive: true, futureStartDate: "2026-11-29" },
      {
        ...openRow,
        recurringType: "ONCE",
        weekdays: ["WED"],
        onceDate: "2026-11-25",
        futureStartDate: "2026-11-25",
        fixturesChoice: "SUBSET",
      },
    ] }] });

    const future = within(screen.getByRole("button", { name: /Morning washroom reset/ }));
    expect(future.getByText("Needs review")).toBeVisible();
    expect(future.getByText("Inactive")).toBeVisible();
    expect(future.getByText(/^Starts .*29 Nov/)).toBeVisible();

    const once = within(screen.getByRole("button", { name: /Lobby floor/ }));
    expect(once.getByText("Once")).toBeVisible();
    expect(once.getByText(/^Once · .*Wed.*25 Nov/)).toBeVisible();
    expect(once.getByText(/· Fixtures/)).toBeVisible();
    expect(once.queryByText(/^Starts/)).not.toBeInTheDocument();
  });

  it("marks the current row and opens the row that was clicked", () => {
    const { onOpen } = renderList({ selectedId: 1 });

    expect(screen.getByRole("button", { current: true })).toHaveAccessibleName(/Morning washroom reset/);
    fireEvent.click(screen.getByRole("button", { name: /Lobby floor/ }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("offers to clear filters when no schedules match", () => {
    const { onClearFilters } = renderList({ groups: [] });

    expect(screen.getByRole("heading", { name: "No schedules match" })).toBeVisible();
    expect(screen.getByText("Nothing matches these filters. Try another word or clear the filters.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClearFilters).toHaveBeenCalledOnce();
  });

  it("renders Urdu labels and keeps record names intact", () => {
    render(
      <LanguageContext.Provider value={{
        language: "ur",
        setLanguage: vi.fn(),
        t: (key, values) => translate(key, "ur", values),
      }}>
        <ScheduleList
          groups={[{ ...morning, rows: [{ ...morningRow, needsReview: true }, openRow] }]}
          selectedId={null}
          onOpen={vi.fn()}
          onClearFilters={vi.fn()}
        />
      </LanguageContext.Provider>,
    );

    expect(screen.getByRole("heading", { name: "صبح" })).toBeVisible();
    const row = within(screen.getByRole("button", { name: /Morning washroom reset/ }));
    expect(row.getByText("06:00–06:45")).toHaveAttribute("dir", "ltr");
    expect(row.getByText("45 منٹ")).toBeVisible();
    expect(row.getByText("پیر–ہفتہ")).toBeVisible();
    expect(row.getByText("جائزہ درکار")).toBeVisible();
    expect(row.getByText("Bilal Ahmed")).toBeVisible();
    expect(screen.getByText("کوئی مقرر نہیں")).toBeVisible();
  });
});
