import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LanguageContext } from "@/i18n/context";
import { translate } from "@/i18n/translations";
import { ScheduleToolbar, type ScheduleToolbarProps } from "./ScheduleToolbar";

function toolbarProps() {
  return {
    view: "list",
    search: "",
    staffFilter: undefined,
    areaFilter: undefined,
    groupBy: "time",
    chip: "all",
    selectedWeekday: null,
    staffOptions: [
      { id: 12, name: "Ayesha Noor", isActive: true },
      { id: 13, name: "Former worker", isActive: false },
    ],
    areaOptions: [{ id: 8, name: "Lobby" }],
    counts: { all: 22, needsAttention: 3, inactive: 1 },
    onViewChange: vi.fn(),
    onSearchChange: vi.fn(),
    onStaffFilterChange: vi.fn(),
    onAreaFilterChange: vi.fn(),
    onGroupByChange: vi.fn(),
    onChipChange: vi.fn(),
    onClearDay: vi.fn(),
  } satisfies ScheduleToolbarProps;
}

function openMenu(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: "Enter" });
  return within(screen.getByRole("menu"));
}

describe("ScheduleToolbar", () => {
  it("reports view, search and quick chip changes without owning their values", () => {
    const props = toolbarProps();
    const { rerender } = render(<ScheduleToolbar {...props} />);
    const view = within(screen.getByRole("group", { name: "View" }));
    const search = screen.getByRole("searchbox", { name: "Search schedules, areas or staff" });
    const all = screen.getByRole("button", { name: /^All\s*22$/, pressed: true });

    fireEvent.click(view.getByRole("button", { name: "Week", pressed: false }));
    fireEvent.change(search, { target: { value: "lobby" } });
    fireEvent.click(screen.getByRole("button", { name: /^Needs attention\s*3$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Inactive\s*1$/ }));
    fireEvent.click(all);

    expect(props.onViewChange).toHaveBeenCalledExactlyOnceWith("week");
    expect(props.onSearchChange).toHaveBeenCalledExactlyOnceWith("lobby");
    expect(props.onChipChange.mock.calls).toEqual([["needsAttention"], ["inactive"], ["all"]]);
    expect(view.getByRole("button", { name: "List", pressed: true })).toBeVisible();
    expect(all).toHaveAttribute("aria-pressed", "true");

    rerender(<ScheduleToolbar {...props} search="lobby" chip="needsAttention" />);
    expect(search).toHaveValue("lobby");
    expect(screen.getByRole("button", { name: /^Needs attention\s*3$/, pressed: true })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(props.onSearchChange).toHaveBeenLastCalledWith("");
  });

  it("offers active staff and forwards staff, area and group selections", () => {
    const props = toolbarProps();
    const { rerender } = render(<ScheduleToolbar {...props} />);
    const staff = screen.getByRole("button", { name: "Staff: All staff" });
    const staffMenu = openMenu(staff);

    expect(staffMenu.queryByRole("menuitemradio", { name: "Former worker" })).not.toBeInTheDocument();
    fireEvent.click(staffMenu.getByRole("menuitemradio", { name: "Ayesha Noor" }));
    fireEvent.click(openMenu(staff).getByRole("menuitemradio", { name: "Unassigned" }));
    fireEvent.click(openMenu(screen.getByRole("button", { name: "Area: All areas" }))
      .getByRole("menuitemradio", { name: "Lobby" }));
    const groupMenu = openMenu(screen.getByRole("button", { name: /Group: Time of day$/ }));
    expect(groupMenu.getByRole("menuitemradio", { name: "Group: Staff" })).toBeVisible();
    fireEvent.click(groupMenu.getByRole("menuitemradio", { name: "Group: Area" }));

    expect(props.onStaffFilterChange.mock.calls).toEqual([[12], ["unassigned"]]);
    expect(props.onAreaFilterChange).toHaveBeenCalledExactlyOnceWith(8);
    expect(props.onGroupByChange).toHaveBeenCalledExactlyOnceWith("area");

    rerender(<ScheduleToolbar {...props} staffFilter="unassigned" areaFilter={8} groupBy="area" />);
    expect(screen.getByRole("button", { name: /Group: Area$/ })).toBeVisible();
    fireEvent.click(openMenu(screen.getByRole("button", { name: "Staff: Unassigned" }))
      .getByRole("menuitemradio", { name: "All staff" }));
    fireEvent.click(openMenu(screen.getByRole("button", { name: "Area: Lobby" }))
      .getByRole("menuitemradio", { name: "All areas" }));
    expect(props.onStaffFilterChange).toHaveBeenLastCalledWith(undefined);
    expect(props.onAreaFilterChange).toHaveBeenLastCalledWith(undefined);
  });

  it("omits grouping and quick chips in Week view, including inside the sheet", () => {
    render(<ScheduleToolbar {...toolbarProps()} view="week" selectedWeekday="MON" />);
    expect(screen.getByRole("button", { name: "Week", pressed: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "Staff: All staff" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Group:|Runs on Mon/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Filters" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const sheet = within(screen.getByRole("dialog", { name: "Filters" }));
    expect(sheet.getByRole("button", { name: "Area: All areas" })).toBeVisible();
    expect(sheet.queryByRole("button", { name: /Group:|Runs on Mon/ })).not.toBeInTheDocument();
    expect(sheet.queryByRole("group", { name: "Filters" })).not.toBeInTheDocument();
  });

  it("hides Inactive at zero and lets the parent clear the selected day", () => {
    const props = toolbarProps();
    const counts = { ...props.counts, inactive: 0 };
    const { rerender } = render(<ScheduleToolbar {...props} counts={counts} selectedWeekday="MON" />);

    expect(screen.queryByRole("button", { name: /Inactive/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Runs on Mon", pressed: true }));
    expect(props.onClearDay).toHaveBeenCalledTimes(1);
    rerender(<ScheduleToolbar {...props} counts={counts} />);
    expect(screen.queryByRole("button", { name: "Runs on Mon" })).not.toBeInTheDocument();
  });

  it("uses the same callbacks from the phone filter sheet", () => {
    const props = toolbarProps();
    render(<ScheduleToolbar {...props} selectedWeekday="MON" />);
    fireEvent.click(screen.getByRole("button", { name: "Filters", expanded: false }));
    const dialog = screen.getByRole("dialog", { name: "Filters" });
    const sheet = within(dialog);

    fireEvent.click(openMenu(sheet.getByRole("button", { name: "Staff: All staff" }))
      .getByRole("menuitemradio", { name: "Unassigned" }));
    fireEvent.click(sheet.getByRole("button", { name: /^Needs attention\s*3$/ }));
    fireEvent.click(sheet.getByRole("button", { name: "Runs on Mon" }));
    expect(props.onStaffFilterChange).toHaveBeenCalledExactlyOnceWith("unassigned");
    expect(props.onChipChange).toHaveBeenCalledExactlyOnceWith("needsAttention");
    expect(props.onClearDay).toHaveBeenCalledTimes(1);

    fireEvent.click(sheet.getByRole("button", { name: "Close" }));
    expect(dialog).not.toBeInTheDocument();
  });

  it("renders Urdu controls without translating record names", () => {
    render(
      <LanguageContext.Provider value={{
        language: "ur", setLanguage: vi.fn(), t: (key, values) => translate(key, "ur", values),
      }}>
        <ScheduleToolbar {...toolbarProps()} selectedWeekday="MON" staffFilter={12} />
      </LanguageContext.Provider>,
    );

    const view = within(screen.getByRole("group", { name: "دیکھیں" }));
    expect(view.getByRole("button", { name: "فہرست" })).toBeVisible();
    expect(view.getByRole("button", { name: "ہفتہ" })).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "شیڈول، حصے یا عملہ تلاش کریں" }))
      .toHaveAttribute("placeholder", "شیڈول، حصے یا عملہ تلاش کریں");
    expect(screen.getByRole("button", { name: "عملہ: Ayesha Noor" })).toBeVisible();
    expect(screen.getByRole("button", { name: "جگہ: تمام حصے" })).toBeVisible();
    expect(screen.getByRole("button", { name: /وقت کے لحاظ سے گروپ$/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "فلٹرز" })).toBeVisible();
    expect(screen.getByRole("button", { name: /^توجہ درکار\s*3$/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /^غیر فعال\s*1$/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "پیر کو مقرر ہے" })).toBeVisible();
  });
});
