import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import type { Language } from "@/i18n/translations";
import type { ScheduleDetails } from "../../schedulePageModel";
import { ScheduleDetailsPanel, type ScheduleDetailsPanelProps } from "./ScheduleDetailsPanel";

vi.mock("@/api/client", () => ({ client: { post: vi.fn() } }));

const details: ScheduleDetails = {
  facts: {
    id: 7,
    title: "Washroom restock",
    areaId: 3,
    areaName: "A block washroom",
    fixturesChoice: "SUBSET",
    worker: { id: 17, name: "Hina Saleem", workDays: ["TUE", "WED", "THU", "FRI", "SAT", "SUN"], shiftText: "12:00–20:00" },
    start: "16:00",
    end: "16:30",
    duration: { hours: 0, minutes: 30 },
    overnight: false,
    weekdays: ["TUE", "THU", "SAT"],
    recurringType: "DAILY",
    effectiveDate: "2026-11-14",
    onceDate: null,
    futureStartDate: null,
    inactive: false,
    needsReview: true,
  },
  nextDays: [
    { date: "2026-11-24", weekday: "TUE", start: "16:00", end: "16:30" },
    { date: "2026-11-26", weekday: "THU", start: "16:00", end: "16:30" },
    { date: "2026-11-28", weekday: "SAT", start: "16:00", end: "16:30" },
  ],
};

function mount(overrides: Partial<ScheduleDetailsPanelProps> = {}, language: Language = "en") {
  localStorage.setItem("hygene-ops.language", language);
  const props = {
    details,
    areaHref: "/locations/2?tab=areas",
    onClose: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LanguageProvider>
        <MemoryRouter>
          <ScheduleDetailsPanel {...props} />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return props;
}

beforeEach(() => { localStorage.clear(); });

describe("ScheduleDetailsPanel", () => {
  it("shows the schedule facts and the three supplied days", () => {
    mount();
    const panel = within(screen.getByRole("dialog", { name: /Washroom restock/ }));
    expect(panel.getByText(/A block washroom/)).toBeVisible();
    expect(panel.getByText("Time")).toBeVisible();
    expect(panel.getByText(/30 min/)).toBeVisible();
    expect(panel.getByText("Repeats")).toBeVisible();
    expect(panel.getByText("Tue, Thu, Sat")).toBeVisible();
    expect(panel.getByText("Fixtures")).toBeVisible();
    expect(panel.getByText("Selected fixtures")).toBeVisible();
    expect(panel.getByText("Started")).toBeVisible();
    expect(panel.getByText("14 Nov 2026")).toBeVisible();
    expect(panel.getByText("Assigned to")).toBeVisible();
    expect(panel.getByText("Hina Saleem")).toBeVisible();
    expect(panel.getByText(/Works Tue–Sun · .*12:00–20:00/)).toBeVisible();
    expect(panel.getByRole("heading", { name: "Next scheduled days" })).toBeVisible();
    const upcoming = panel.getAllByRole("listitem");
    expect(upcoming).toHaveLength(3);
    ["Tue 24 Nov", "Thu 26 Nov", "Sat 28 Nov"].forEach((date, index) => {
      expect(upcoming[index]).toHaveTextContent(date);
      expect(upcoming[index]).toHaveTextContent("16:00–16:30");
    });
  });

  it("links to area review when inventory is flagged", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Inventory needs review" })).toBeVisible();
    expect(screen.getByText("Review the area's updated fixtures before the next task.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Review area" })).toHaveAttribute("href", "/locations/2?tab=areas");
  });

  it("shows a future, one-time unassigned schedule without a review notice or upcoming days", () => {
    mount({
      details: {
        facts: {
          ...details.facts,
          worker: null,
          fixturesChoice: "ALL",
          recurringType: "ONCE",
          effectiveDate: "2027-02-01",
          onceDate: "2027-02-01",
          futureStartDate: "2027-02-01",
          needsReview: false,
        },
        nextDays: [],
      },
    });
    expect(screen.getByText("Unassigned")).toBeVisible();
    expect(screen.getByText("Once")).toBeVisible();
    expect(screen.getByText("All active fixtures")).toBeVisible();
    expect(screen.getByText(/Starts .*1 Feb 2027/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Inventory needs review" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Review area" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Next scheduled days" })).toBeNull();
  });

  it("exposes Edit and Close without a Pause action", () => {
    const { onEdit, onClose } = mount();
    expect(screen.queryByRole("button", { name: /Pause/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit schedule" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses the existing history-preserving confirmation and waits for the delete callback", async () => {
    let finish!: () => void;
    const onDelete = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    mount({ onDelete });
    fireEvent.click(screen.getByRole("button", { name: "Delete Washroom restock" }));
    const confirmation = within(screen.getByRole("dialog", { name: /Delete Washroom restock/ }));
    expect(confirmation.getByText(/Past task history and recorded evidence are kept/)).toBeVisible();
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(confirmation.getByRole("button", { name: "Cancel" }));
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete Washroom restock" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete schedule" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByRole("dialog", { name: /Washroom restock/ })).toBeVisible());
  });

  it("disables the delete trigger when the caller marks deletion unavailable", () => {
    mount({ deleteDisabled: true });
    expect(screen.getByRole("button", { name: "Delete Washroom restock" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit schedule" })).toBeEnabled();
  });

  it("renders nothing for a closed panel", () => {
    mount({ details: null });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("localizes the panel in Urdu and preserves names that happen to match translation keys", () => {
    mount({ details: { ...details, facts: { ...details.facts, title: "Time", areaName: "Area" } } }, "ur");
    const dialog = screen.getByRole("dialog", { name: /Time/ });
    expect(dialog).toHaveAttribute("dir", "rtl");
    expect(dialog).toHaveAccessibleDescription(/Area/);
    const panel = within(dialog);
    expect(panel.getByText("وقت")).toBeVisible();
    expect(panel.getByText("دہرائے جانے کے دن")).toBeVisible();
    expect(panel.getByText("فکسچر")).toBeVisible();
    expect(panel.getByText("منتخب فکسچر")).toBeVisible();
    expect(panel.getByText("Hina Saleem")).toBeVisible();
    expect(panel.getByRole("heading", { name: "اگلے مقررہ دن" })).toBeVisible();
    expect(panel.getByRole("link", { name: "حصے کا جائزہ لیں" })).toBeVisible();
    expect(panel.getByRole("button", { name: "شیڈول بدلیں" })).toBeVisible();
  });
});
