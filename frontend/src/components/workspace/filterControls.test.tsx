import { useState, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LanguageContext } from "@/i18n/context";
import { translate, type Language } from "@/i18n/translations";
import { SelectMenu, type FilterOption } from "./SelectMenu";
import { DateMenu, type DateMenuProps } from "./DateMenu";
import { FindField } from "./FindField";
import { ChipGroup } from "./ChipGroup";
import { SegmentedControl } from "./SegmentedControl";

function Language({ children, language = "en" }: { children: ReactNode; language?: Language }) {
  return <LanguageContext.Provider value={{ language, setLanguage: () => {}, t: (text, values) => translate(text, language, values) }}>
    <div className="workspace" dir={language === "ur" ? "rtl" : "ltr"} lang={language === "ur" ? "ur-PK" : "en-PK"}>{children}</div>
  </LanguageContext.Provider>;
}
const options: FilterOption[] = [
  { value: "", label: "All locations" },
  { value: "site", label: "Location record", translateLabel: false },
  { value: "disabled", label: "Unavailable", disabled: true },
];
function dateName(day: string, language: Language = "en") {
  return new Intl.DateTimeFormat(language === "ur" ? "ur-PK" : "en-PK", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}
function Calendar(props: Partial<DateMenuProps> = {}) {
  return <DateMenu value="2026-11-10" localDate="2026-11-10" onChange={() => {}} {...props} />;
}
function openDate() { fireEvent.click(screen.getByRole("button", { name: /^Date:/ })); }
function openSelect() { fireEvent.keyDown(screen.getByRole("button", { name: /^Location:/ }), { key: "ArrowDown" }); }

describe("SelectMenu", () => {
  it("opens a named radio menu, ticks the controlled selection, reports the value and returns focus", async () => {
    const changed = vi.fn();
    function Controlled() {
      const [value, setValue] = useState("");
      return <SelectMenu label="Location" value={value} options={options} onChange={next => { setValue(next); changed(next); }} />;
    }
    render(<Controlled />);
    openSelect();
    const menu = screen.getByRole("menu", { name: "Location" });
    expect(within(menu).getByRole("menuitemradio", { name: "All locations" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Location record" }));
    expect(changed).toHaveBeenCalledExactlyOnceWith("site");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Location: Location record" })).toHaveFocus());
  });

  it("closes on Escape without changing the value and returns focus", async () => {
    const onChange = vi.fn();
    render(<SelectMenu label="Location" value="" options={options} onChange={onChange} />);
    openSelect();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Location: All locations" })).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("navigates with arrows and skips disabled options", async () => {
    render(<SelectMenu label="Location" value="" options={options} onChange={() => {}} />);
    openSelect();
    const first = screen.getByRole("menuitemradio", { name: "All locations" });
    await waitFor(() => expect(first).toHaveFocus());
    fireEvent.keyDown(first, { key: "ArrowDown" });
    await waitFor(() => expect(screen.getByRole("menuitemradio", { name: "Location record" })).toHaveFocus());
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    await waitFor(() => expect(first).toHaveFocus());
  });

  it("never selects a disabled option", () => {
    const onChange = vi.fn();
    render(<SelectMenu label="Location" value="" options={options} onChange={onChange} />);
    openSelect();
    const option = screen.getByRole("menuitemradio", { name: "Unavailable" });
    expect(option).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(option);
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([true, false])("handles a disabled or empty list (disabled=%s)", disabled => {
    render(<SelectMenu label="Location" value="missing" options={disabled ? options : []} disabled={disabled} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Location: Location" })).toBeDisabled();
  });

  it("translates interface labels but preserves record data in an RTL body portal", () => {
    render(<Language language="ur"><SelectMenu label="Location" value="site" options={[...options, { value: "record", label: "Today", translateLabel: false }]} onChange={() => {}} /></Language>);
    const trigger = screen.getByRole("button", { name: `${translate("Location", "ur")}: Location record` });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const menu = screen.getByRole("menu", { name: translate("Location", "ur") });
    expect(menu).toHaveAttribute("dir", "rtl");
    expect(menu.closest(".workspace")).toHaveAttribute("lang", "ur-PK");
    expect(within(menu).getByRole("menuitemradio", { name: "Today" })).toBeVisible();
    expect(within(menu).getByRole("menuitemradio", { name: translate("All locations", "ur") })).toBeVisible();
    expect(trigger.closest(".workspace")).not.toContainElement(menu);
  });
});

describe("DateMenu", () => {
  it("selects a local YYYY-MM-DD day and closes with focus returned", async () => {
    const onChange = vi.fn();
    render(<Calendar onChange={onChange} />);
    openDate();
    expect(screen.getByRole("grid", { name: "November 2026" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: dateName("2026-11-09") }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("2026-11-09");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^Date:/ })).toHaveFocus();
  });

  it("blocks dates and month navigation after maxDate", () => {
    const onChange = vi.fn();
    render(<Calendar maxDate="2026-11-10" onChange={onChange} />);
    openDate();
    const future = screen.getByRole("button", { name: dateName("2026-11-11") });
    expect(future).toBeDisabled();
    fireEvent.click(future);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: dateName("2026-11-10") }));
    expect(onChange).toHaveBeenCalledWith("2026-11-10");
  });

  it.each([["Today", "today"], ["Yesterday", "2026-11-09"]])("reports the %s quick option", (label, value) => {
    const onChange = vi.fn();
    render(<Calendar onChange={onChange} />);
    openDate();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(value);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("disables future quick options and supports an explicit All dates option", () => {
    const onChange = vi.fn();
    render(<Calendar maxDate="2026-11-08" quickOptions={[{ label: "Today", value: "today" }, { label: "Yesterday", value: "2026-11-09" }, { label: "All dates", value: "" }]} onChange={onChange} />);
    openDate();
    expect(screen.getByRole("button", { name: "Today" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Yesterday" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "All dates" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("");
  });

  it("starts weeks on Monday and preserves selected and current date semantics", () => {
    render(<Calendar value="today" />);
    openDate();
    expect(screen.getAllByRole("columnheader").map(el => el.getAttribute("aria-label"))).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
    const today = screen.getByRole("button", { name: dateName("2026-11-10") });
    expect(today).toHaveAttribute("aria-current", "date");
    expect(today.closest("td")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "true");
  });

  it("supports previous/next month and starts from the latest controlled value on reopening", () => {
    const { rerender } = render(<Calendar />);
    openDate();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("grid", { name: "October 2026" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("grid", { name: "November 2026" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    rerender(<Calendar value="2027-02-12" />);
    openDate();
    expect(screen.getByRole("grid", { name: "February 2027" })).toBeInTheDocument();
  });

  it("supports arrow, week-boundary and month keyboard navigation with one day tab stop", () => {
    render(<Calendar />);
    openDate();
    const day = screen.getByRole("button", { name: dateName("2026-11-10") });
    day.focus();
    fireEvent.keyDown(day, { key: "ArrowLeft" });
    expect(screen.getByRole("button", { name: dateName("2026-11-09") })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(screen.getByRole("button", { name: dateName("2026-11-15") })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(screen.getByRole("button", { name: dateName("2026-11-02") })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "PageUp" });
    expect(screen.getByRole("button", { name: dateName("2026-10-02") })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "PageDown", shiftKey: true });
    expect(screen.getByRole("button", { name: dateName("2027-10-02") })).toHaveFocus();
    expect(within(screen.getByRole("grid")).getAllByRole("button").filter(el => el.tabIndex === 0)).toHaveLength(1);
  });

  it("does not move keyboard focus into a disabled date", () => {
    render(<Calendar maxDate="2026-11-10" />);
    openDate();
    const day = screen.getByRole("button", { name: dateName("2026-11-10") });
    day.focus();
    fireEvent.keyDown(day, { key: "ArrowRight" });
    expect(day).toHaveFocus();
  });

  it("clamps month keyboard navigation to leap month's last day", () => {
    render(<Calendar value="2024-01-31" />);
    openDate();
    const day = screen.getByRole("button", { name: dateName("2024-01-31") });
    day.focus();
    fireEvent.keyDown(day, { key: "PageDown" });
    expect(screen.getByRole("button", { name: dateName("2024-02-29") })).toHaveFocus();
  });

  it("rejects invalid date overflow instead of silently selecting a different month", () => {
    render(<Calendar value="2026-02-30" maxDate="invalid" />);
    expect(screen.getByRole("button", { name: "Date: All dates" })).toBeVisible();
    openDate();
    expect(screen.getByRole("grid", { name: "November 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next month" })).toBeEnabled();
  });

  it("uses the device's local date when no location day is supplied", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 0, 30));
    try {
      render(<DateMenu value="today" onChange={() => {}} />);
      openDate();
      expect(screen.getByRole("button", { name: dateName("2026-01-01") })).toHaveAttribute("aria-current", "date");
      expect(screen.getByRole("grid", { name: "January 2026" })).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it("closes on Escape without emitting a value", async () => {
    const onChange = vi.fn();
    render(<Calendar onChange={onChange} />);
    openDate();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Date:/ })).toHaveFocus());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("translates the calendar and mirrors horizontal keyboard navigation under Urdu", () => {
    render(<Language language="ur"><Calendar /></Language>);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${translate("Date", "ur")}:`) }));
    expect(screen.getByRole("dialog")).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("button", { name: translate("Previous month", "ur") })).toBeVisible();
    const day = screen.getByRole("button", { name: dateName("2026-11-10", "ur") });
    day.focus();
    fireEvent.keyDown(day, { key: "ArrowLeft" });
    expect(screen.getByRole("button", { name: dateName("2026-11-11", "ur") })).toHaveFocus();
  });

  it("disables the trigger and can omit all quick options", () => {
    const { rerender } = render(<Calendar disabled />);
    expect(screen.getByRole("button", { name: /^Date:/ })).toBeDisabled();
    rerender(<Calendar quickOptions={[]} />);
    openDate();
    expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();
  });
});

describe.each([ChipGroup, SegmentedControl])("%s", Control => {
  it("exposes a named single-selection group and emits the chosen value", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Control label="Period" value="7" options={[{ value: "7", label: "Last 7 days", count: 0 }, { value: "30", label: "Last 30 days" }]} onChange={onChange} />);
    const group = screen.getByRole("group", { name: "Period" });
    expect(within(group).getByRole("button", { name: /Last 7 days/ })).toHaveAttribute("aria-pressed", "true");
    const thirty = within(group).getByRole("button", { name: "Last 30 days" });
    expect(thirty).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(thirty);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("30");
    // Props remain authoritative until the caller updates them.
    expect(thirty).toHaveAttribute("aria-pressed", "false");
    rerender(<Control label="Period" value="30" options={[{ value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }]} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Last 30 days" })).toHaveAttribute("aria-pressed", "true");
  });
  it("keeps disabled options inert", () => {
    const onChange = vi.fn();
    render(<Control label="Location" value="" options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Unavailable" }));
    expect(onChange).not.toHaveBeenCalled();
  });
  it("disables the whole group", () => {
    render(<Control label="Location" value="" options={options} onChange={() => {}} disabled />);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });
  it("translates interface labels and preserves record labels under Urdu", () => {
    render(<Language language="ur"><Control label="Location" value="" options={[...options, { value: "record", label: "Today", translateLabel: false }]} onChange={() => {}} /></Language>);
    expect(screen.getByRole("group", { name: translate("Location", "ur") })).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("button", { name: translate("All locations", "ur") })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Today" })).toBeVisible();
  });
});

describe("FindField", () => {
  it("reports typed input, clears and restores input focus", () => {
    const onChange = vi.fn();
    function Controlled() {
      const [value, setValue] = useState("");
      return <FindField label="Search name" value={value} onChange={next => { onChange(next); setValue(next); }} />;
    }
    render(<Controlled />);
    const input = screen.getByRole("searchbox", { name: "Search name" });
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "a name" } });
    expect(onChange).toHaveBeenCalledWith("a name");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });
  it.each(["disabled", "readOnly"] as const)("keeps clearing inert when %s", state => {
    const onChange = vi.fn();
    render(<FindField label="Search name" value="name" onChange={onChange} {...{ [state]: true }} />);
    const clear = screen.getByRole("button", { name: "Clear search" });
    expect(clear).toBeDisabled();
    fireEvent.click(clear);
    expect(onChange).not.toHaveBeenCalled();
  });
  it("translates the search label, placeholder and clear action without changing typed text", () => {
    render(<Language language="ur"><FindField label="Search name" value="Typed name" onChange={() => {}} /></Language>);
    const input = screen.getByRole("searchbox", { name: translate("Search name", "ur") });
    expect(input).toHaveValue("Typed name");
    expect(input).toHaveAttribute("placeholder", translate("Search name", "ur"));
    expect(screen.getByRole("button", { name: translate("Clear search", "ur") })).toBeVisible();
  });
});
