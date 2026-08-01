import { useState, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceTheme } from "@/components/common/WorkspaceTheme";
import { LanguageContext } from "@/i18n/context";
import { translate, type Language } from "@/i18n/translations";
import { SidePanel, SidePanelFieldError, SidePanelFooter, type SidePanelProps } from "./SidePanel";

function Providers({ children, language = "en", workspace = true }: { children: ReactNode; language?: Language; workspace?: boolean }) {
  return <LanguageContext.Provider value={{ language, setLanguage: () => {}, t: (text, values) => translate(text, language, values) }}>
    <WorkspaceTheme.Provider value={workspace}>
      <div className="workspace" dir={language === "ur" ? "rtl" : "ltr"}>{children}</div>
    </WorkspaceTheme.Provider>
  </LanguageContext.Provider>;
}

function Harness({ pending = false, changed = () => {}, ...props }: Partial<SidePanelProps> & { pending?: boolean; changed?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Open panel</button>
    <button>Outside action</button>
    <SidePanel title="Add location" open={open} onOpenChange={next => { changed(next); if (!pending) setOpen(next); }}
      footer={<SidePanelFooter><button>Cancel</button><button>Save changes</button></SidePanelFooter>} {...props}>
      <label>Location name<input aria-label="Location name" /></label>
    </SidePanel>
  </>;
}

function openPanel() {
  const trigger = screen.getByRole("button", { name: "Open panel" });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}
const outsidePointer = async () => {
  // Radix installs its document pointer listener after the opening event.
  await new Promise(resolve => setTimeout(resolve, 0));
  fireEvent.pointerDown(document.body, { button: 0 });
};

describe("SidePanel", () => {
  it("is absent while closed and opens as a named modal dialog with described content and footer", () => {
    render(<Providers><Harness description="Find your site and set where your team can check in." /></Providers>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    openPanel();
    const dialog = screen.getByRole("dialog", { name: "Add location" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("Find your site and set where your team can check in.");
    expect(within(dialog).getByRole("textbox", { name: "Location name" })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeVisible();
    expect(within(dialog).getByRole("heading", { name: "Add location" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Open panel", hidden: true }).closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("supports an omitted description and footer without Radix accessibility warnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Providers><Harness footer={undefined} /></Providers>);
    openPanel();
    expect(screen.getByRole("dialog", { name: "Add location" })).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("closes on Escape and returns focus to the actual opener", async () => {
    const changed = vi.fn();
    render(<Providers><Harness changed={changed} /></Providers>);
    const trigger = openPanel();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(changed).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("closes with the translated close control and restores focus", async () => {
    render(<Providers><Harness /></Providers>);
    const trigger = openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("dismisses on a pointer outside the dialog and restores focus", async () => {
    render(<Providers><Harness /></Providers>);
    const trigger = openPanel();
    await outsidePointer();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it.each(["Escape", "Close", "Outside"])("lets a pending caller refuse %s dismissal, retaining the draft and focus", async method => {
    const changed = vi.fn();
    render(<Providers><Harness pending changed={changed} /></Providers>);
    openPanel();
    const field = screen.getByRole("textbox", { name: "Location name" });
    fireEvent.change(field, { target: { value: "Unsaved name" } });
    field.focus();
    if (method === "Escape") fireEvent.keyDown(field, { key: "Escape" });
    else if (method === "Close") fireEvent.click(screen.getByRole("button", { name: "Close" }));
    else await outsidePointer();
    expect(changed).toHaveBeenCalledExactlyOnceWith(false);
    expect(screen.getByRole("dialog", { name: "Add location" })).toBeVisible();
    expect(field).toHaveValue("Unsaved name");
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
  });

  it("allows dismissal once a pending caller finishes saving", async () => {
    const { rerender } = render(<Providers><Harness pending /></Providers>);
    const trigger = openPanel();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeVisible();
    rerender(<Providers><Harness pending={false} /></Providers>);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("traps Tab and Shift+Tab at the dialog boundaries", () => {
    render(<Providers><Harness /></Providers>);
    openPanel();
    const first = screen.getByRole("button", { name: "Close" });
    const last = screen.getByRole("button", { name: "Save changes" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("prevents programmatic focus from escaping the modal", () => {
    render(<Providers><Harness /></Providers>);
    const outside = screen.getByRole("button", { name: "Outside action" });
    openPanel();
    const field = screen.getByRole("textbox", { name: "Location name" });
    field.focus();
    outside.focus();
    expect(field).toHaveFocus();
  });

  it("translates its name, description and close label and preserves RTL through the portal", () => {
    const description = "Find your site and set where your team can check in.";
    const { container } = render(<Providers language="ur"><Harness description={description} wide /></Providers>);
    openPanel();
    const dialog = screen.getByRole("dialog", { name: translate("Add location", "ur") });
    expect(dialog).toHaveAttribute("dir", "rtl");
    expect(dialog).toHaveAccessibleDescription(translate(description, "ur"));
    expect(dialog.closest("[lang]")).toHaveAttribute("lang", "ur-PK");
    expect(within(dialog).getByRole("button", { name: translate("Close", "ur") })).toBeVisible();
    expect(container).not.toContainElement(dialog);
  });

  it.each([true, false])("carries the WorkspaceTheme context into the portal (workspace=%s)", workspace => {
    render(<Providers workspace={workspace}><Harness /></Providers>);
    openPanel();
    const dialog = screen.getByRole("dialog");
    if (workspace) expect(dialog).toHaveClass("workspace-dialog");
    else expect(dialog).not.toHaveClass("workspace-dialog");
    expect(dialog.closest(".workspace")).toBeInTheDocument();
    expect(dialog).toHaveAttribute("dir", "ltr");
  });

  it("updates controlled title and content without blanking a mounted panel or moving focus", () => {
    const { rerender } = render(<Providers><Harness title="Add location" /></Providers>);
    openPanel();
    const field = screen.getByRole("textbox", { name: "Location name" });
    field.focus();
    fireEvent.change(field, { target: { value: "Draft" } });
    rerender(<Providers><Harness title="Edit location" /></Providers>);
    expect(screen.getByRole("dialog", { name: "Edit location" })).toBeVisible();
    expect(field).toHaveFocus();
    expect(field).toHaveValue("Draft");
  });
});

describe("SidePanel helpers", () => {
  it("renders footer actions with their disabled and form submission semantics intact", () => {
    render(<SidePanelFooter><button type="button" disabled>Cancel</button><button type="submit" form="edit-form">Save changes</button></SidePanelFooter>);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveAttribute("form", "edit-form");
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveAttribute("type", "submit");
  });

  it("exposes a translated field error associated with its invalid input", () => {
    const message = "This field is required.";
    render(<Providers language="ur"><input aria-label="Location" aria-invalid="true" aria-describedby="name-error" />
      <SidePanelFieldError id="name-error">{message}</SidePanelFieldError></Providers>);
    expect(screen.getByRole("alert")).toHaveTextContent(translate(message, "ur"));
    expect(screen.getByRole("textbox", { name: "Location" })).toHaveAccessibleDescription(translate(message, "ur"));
  });

  it.each([undefined, null, "", "   "])("omits an absent error (%s)", children => {
    render(<SidePanelFieldError id="name-error">{children}</SidePanelFieldError>);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
