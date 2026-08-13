import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import type { LocationStaff, TaskTemplate } from "../../types";
import LocationTemplatesTab from "../LocationTemplatesTab";

const { remove } = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock("@/pages/Task/queries", () => ({
  useDeleteTaskTemplate: () => ({ mutateAsync: remove }),
  useEditTaskTemplate: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/pages/Assignment/queries", () => ({
  useAssignStaffToTemplate: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/pages/Area/api", () => ({ getAreas: vi.fn().mockResolvedValue([]) }));

const staff: LocationStaff[] = Array.from({ length: 6 }, (_, index) => ({
  id: index + 1,
  name: `Worker ${index + 1}`,
  email: null,
  shiftStart: null,
  shiftEnd: null,
  workDays: index === 0 ? ["MON", "TUE", "WED", "THU", "FRI"] : undefined,
  isActive: true,
}));

const templates: TaskTemplate[] = Array.from({ length: 22 }, (_, index) => {
  const startHour = [6, 12, 17, 22][index % 4];
  return {
    id: index + 1,
    title: index === 0 ? "Lobby polish" : index === 1 ? "Window wash" : `Schedule ${index + 1}`,
    staffId: index < 2 ? null : (index % staff.length) + 1,
    area: { id: 1, name: "Ground floor" },
    effectiveDate: "2026-11-09",
    shiftStart: `2026-11-09T${String(startHour - 5).padStart(2, "0")}:00:00Z`,
    shiftEnd: `2026-11-09T${String(startHour - 5).padStart(2, "0")}:45:00Z`,
    recurringType: "DAILY",
    repeatDays: index % 2 === 0 ? ["MON", "WED"] : ["TUE", "SUN"],
    setupStatus: index === 2 ? "NEEDS_REVIEW" : undefined,
    isActive: true,
  };
});

function Route() {
  return <output aria-label="Route">{useLocation().search}</output>;
}

function mount({
  records = templates,
  route = "/locations/1?tab=templates&week=2026-11-16&source=setup",
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter initialEntries={[route]}>
          <div className="workspace">
            <LocationTemplatesTab templates={records} staffList={staff}
              locationId={1} timeZone="Asia/Karachi" locationName="Saved site" />
            <Route />
          </div>
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

function chooseView(view: "List" | "Week") {
  fireEvent.click(within(screen.getByRole("group", { name: "View" })).getByRole("button", { name: view }));
}

beforeEach(() => {
  localStorage.setItem("hygene-ops.language", "en");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-21T20:00:00Z"));
  remove.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.removeItem("hygene-ops.language");
});

it("shows all 22 schedules once in grouped lists, with the location summary", () => {
  mount();
  expect(screen.getAllByRole("heading", { name: "Cleaning schedules" })).toHaveLength(1);
  expect(screen.getByText(/22 schedules · 6 staff at this location/)).toBeInTheDocument();
  for (const group of ["Morning", "Afternoon", "Evening", "Night"]) {
    expect(screen.getByRole("heading", { name: group })).toBeInTheDocument();
  }
  expect(screen.getAllByRole("listitem")).toHaveLength(22);
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.queryByText("Daily schedules include every day, including weekends.")).not.toBeInTheDocument();
});

it("narrows the list with search and restores it with Clear filters", () => {
  mount();
  const search = screen.getByRole("searchbox", { name: "Search schedules, areas or staff" });
  fireEvent.change(search, { target: { value: "lobby" } });
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByRole("button", { name: /Lobby polish/ })).toBeInTheDocument();
  fireEvent.change(search, { target: { value: "carpet shampoo" } });
  expect(screen.getByRole("heading", { name: "No schedules match" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(search).toHaveValue("");
  expect(screen.getAllByRole("listitem")).toHaveLength(22);
});

it("filters by the chosen coverage day and clears it from the day chip", () => {
  mount();
  const monday = screen.getByRole("button", { name: /^Monday 16 November/ });
  fireEvent.click(monday);
  expect(monday).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: /Lobby polish/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Window wash/ })).not.toBeInTheDocument();
  expect(screen.getAllByRole("listitem")).toHaveLength(11);
  fireEvent.click(screen.getByRole("button", { name: "Runs on Mon" }));
  expect(monday).toHaveAttribute("aria-pressed", "false");
  expect(screen.getAllByRole("listitem")).toHaveLength(22);
});

it("selects Needs attention from the header, including assigned schedules that need review", () => {
  mount({ route: "/locations/1?tab=templates&view=week" });
  fireEvent.click(screen.getByRole("button", { name: "2 need a worker" }));
  expect(screen.getByRole("button", { name: /^Needs attention/, pressed: true })).toBeInTheDocument();
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  expect(screen.getByRole("button", { name: /Schedule 3.*Needs review/ })).toBeInTheDocument();
  expect(screen.getByLabelText("Route")).toHaveTextContent("?tab=templates");
  expect(screen.getByLabelText("Route")).not.toHaveTextContent("view=");
});

it("opens the staff week from the URL and shows days off", () => {
  mount({ route: "/locations/1?tab=templates&week=2026-11-16&view=week" });
  const table = within(screen.getByRole("table", { name: "Week" }));
  expect(table.getAllByRole("rowheader")).toHaveLength(7);
  const worker = table.getByRole("row", { name: /Worker 1/ });
  expect(within(worker).getAllByText("Day off")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Week", pressed: true })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Morning" })).not.toBeInTheDocument();
});

it("selects the agenda day independently of the list filter and resets it for a new week", () => {
  mount({ records: templates.slice(0, 2) });
  fireEvent.click(screen.getByRole("button", { name: /^Monday 16 November/ }));
  chooseView("Week");
  expect(screen.getByRole("heading", { name: /Sun,? 22 Nov/ })).toBeInTheDocument();
  expect(screen.getByLabelText("Route")).toHaveTextContent("view=week");
  expect(screen.getByLabelText("Route")).toHaveTextContent("source=setup");
  fireEvent.click(screen.getByRole("button", { name: /^Tuesday 17 November/ }));
  const agenda = within(screen.getByRole("region", { name: /Tue,? 17 Nov/ }));
  expect(agenda.getByRole("button", { name: /Window wash/ })).toBeInTheDocument();
  chooseView("List");
  expect(screen.getByRole("button", { name: "Runs on Mon" })).toBeInTheDocument();
  chooseView("Week");
  fireEvent.click(screen.getByRole("button", { name: "Next week" }));
  expect(screen.getByRole("heading", { name: /Mon,? 23 Nov/ })).toBeInTheDocument();
});

it("opens row details and hands off to the existing edit form with the saved values", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: /Lobby polish/ }));
  const details = within(screen.getByRole("dialog", { name: /Lobby polish/ }));
  expect(details.getByText("06:00–06:45", { selector: "strong > bdi" })).toBeInTheDocument();
  fireEvent.click(details.getByRole("button", { name: "Edit schedule" }));
  expect(screen.queryByRole("dialog", { name: /Lobby polish/ })).not.toBeInTheDocument();
  const form = within(screen.getByRole("dialog", { name: "Edit cleaning schedule" }));
  expect(form.getByRole("textbox", { name: "Schedule title" })).toHaveValue("Lobby polish");
  expect(form.getByLabelText("Shift start")).toHaveValue("06:00");
  expect(form.getByRole("combobox", { name: "Recurrence" })).toHaveValue("CHOSEN");
});

it("opens details from an existing schedule deep link", () => {
  mount({ route: "/locations/1?tab=templates#schedule-2" });
  const details = screen.getByRole("dialog", { name: /Window wash/ });
  fireEvent.click(within(details).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("confirms deletion, keeps details on error and closes them on success", async () => {
  remove.mockRejectedValueOnce(new Error("Delete failed"));
  mount();
  fireEvent.click(screen.getByRole("button", { name: /Lobby polish/ }));
  fireEvent.click(screen.getByRole("button", { name: "Delete Lobby polish" }));
  const confirmation = within(screen.getByRole("dialog", { name: "Delete Lobby polish?" }));
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(confirmation.getByRole("button", { name: "Delete schedule" }));
  expect(await confirmation.findByRole("alert")).toHaveTextContent("Could not delete this record");
  fireEvent.click(confirmation.getByRole("button", { name: "Delete schedule" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(remove.mock.calls).toEqual([[1], [1]]);
});

it("shows the first-schedule state without the header action, coverage or toolbar", () => {
  mount({ records: [] });
  expect(screen.getByRole("heading", { name: "No cleaning schedules yet" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add the first schedule" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add cleaning schedule" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "This week" })).not.toBeInTheDocument();
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
});
