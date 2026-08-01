import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LanguageContext } from "@/i18n/context";
import { translate } from "@/i18n/translations";
import { SidePanel, SidePanelFieldError } from "./SidePanel";
import { WeekdayPicker } from "./WeekdayPicker";

describe("WeekdayPicker", () => {
  it("names the group and buttons and exposes the selection in weekday order", () => {
    render(<WeekdayPicker label="Work days" value={["MON", "WED"]} summaryKind="staff" onChange={vi.fn()} />);
    const group = within(screen.getByRole("group", { name: "Work days" }));
    const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    expect(group.getAllByRole("button")).toEqual(names.map(name => group.getByRole("button", { name })));
    expect(group.getAllByRole("button", { pressed: true })).toEqual([
      group.getByRole("button", { name: "Monday" }),
      group.getByRole("button", { name: "Wednesday" }),
    ]);
    expect(group.getByRole("button", { name: "Monday" })).toHaveTextContent("Mon");
    expect(screen.getByText("Works 2 days: Mon, Wed")).toBeVisible();
  });

  it("adds a weekday in canonical order", () => {
    const onChange = vi.fn();
    render(<WeekdayPicker label="Work days" value={["WED", "MON"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Tuesday", pressed: false }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(["MON", "TUE", "WED"]);
  });

  it("lets the caller clear the last day and redisplay the empty selection", () => {
    const onChange = vi.fn();
    const { rerender } = render(<WeekdayPicker label="Work days" value={["MON"]} summaryKind="staff" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Monday", pressed: true }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith([]);
    rerender(<WeekdayPicker label="Work days" value={[]} summaryKind="staff" onChange={onChange} />);
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
    expect(screen.queryByText(/^Works /)).not.toBeInTheDocument();
  });

  it("defaults to every day and disables the buttons when asked", () => {
    const onChange = vi.fn();
    render(<WeekdayPicker label="Repeat on" summaryKind="schedule" disabled onChange={onChange} />);
    const group = screen.getByRole("group", { name: "Repeat on" });
    const buttons = within(group).getAllByRole("button", { pressed: true });
    expect(buttons).toHaveLength(7);
    for (const button of buttons) expect(button).toBeDisabled();
    fireEvent.click(buttons[0]);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Repeats every day")).toBeVisible();
  });

  it("uses right-to-left Urdu names and a translated schedule summary", () => {
    render(
      <LanguageContext.Provider value={{ language: "ur", setLanguage: vi.fn(), t: (key, values) => translate(key, "ur", values) }}>
        <WeekdayPicker label="Repeat on" value={["MON", "WED"]} summaryKind="schedule" onChange={vi.fn()} />
      </LanguageContext.Provider>,
    );
    const group = screen.getByRole("group", { name: "دہرائے جانے کے دن" });
    expect(group).toHaveAttribute("dir", "rtl");
    expect(within(group).getByRole("button", { name: "پیر", pressed: true })).toBeVisible();
    expect(within(group).getByRole("button", { name: "منگل", pressed: false })).toBeVisible();
    expect(screen.getByText("پیر، بدھ کو دہرایا جاتا ہے")).toBeVisible();
  });

  it("renders in the SidePanel portal and allows the form to focus and describe the invalid group", () => {
    const { container } = render(
      <SidePanel title="Add staff" open onOpenChange={vi.fn()}>
        <WeekdayPicker label="Work days" value={[]} id="work-days" errorId="work-days-error" onChange={vi.fn()} />
        <SidePanelFieldError id="work-days-error">Choose at least one work day.</SidePanelFieldError>
      </SidePanel>,
    );
    const dialog = screen.getByRole("dialog", { name: "Add staff" });
    expect(container).not.toContainElement(dialog);
    const group = within(dialog).getByRole("group", { name: "Work days" });
    expect(within(group).getAllByRole("button")).toHaveLength(7);
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Choose at least one work day.");
    expect(group).toHaveAttribute("aria-describedby", "work-days-error");
    expect(group).toHaveAccessibleDescription("Choose at least one work day.");
    const field = document.getElementById("work-days");
    expect(field).toBe(group);
    field?.focus();
    expect(group).toHaveFocus();
  });
});
