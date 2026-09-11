import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { WorkspaceTheme } from "@/components/common/WorkspaceTheme";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import type { Weekday } from "@/lib/workDays";
import type { Area } from "@/pages/Area/types";
import TaskScheduleWizard from "./TaskScheduleWizard";

const mock = vi.hoisted(() => ({ getAreas: vi.fn(), post: vi.fn() }));
vi.mock("@/pages/Area/api", () => ({ getAreas: mock.getAreas, getArea: vi.fn(), getMappingTemplates: vi.fn() }));
vi.mock("@/api/client", () => ({ client: { post: mock.post } }));
vi.mock("@/lib/invalidateWorkspace", () => ({ invalidateWorkspace: async () => undefined }));

const area: Area = {
  id: 10, locationId: 20, name: "North washroom", roomType: "WASHROOM", status: "ACTIVE",
  inventoryVersion: 3, qrVersion: 1, layoutInstructions: null,
  items: [{
    id: 11, areaId: 10, stableCode: "SINK-01", displayName: "Left basin", fixtureType: "SINK",
    positionHint: null, sequence: 1, identificationMode: "ORDERED_CONTEXT", existingNumber: null,
    status: "ACTIVE", rubricKey: "sink", requiredViews: [{ key: "front", mandatory: true }],
  }],
};

const date = "2099-06-15";
const worker = { id: 7, name: "Sam", email: null, shiftStart: "08:00", shiftEnd: "16:00", isActive: true };

function mount(language: "en" | "ur" = "en", workDays?: Weekday[]) {
  localStorage.setItem("hygene-ops.language", language);
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queries}>
      <LanguageProvider>
        <WorkspaceTheme.Provider value>
          <MemoryRouter>
            <TaskScheduleWizard
              locationId={20} locationName="North site" timeZone="Asia/Karachi"
              staffOptions={[{ ...worker, workDays }]} open onOpenChange={vi.fn()} onCreated={vi.fn()}
            />
          </MemoryRouter>
        </WorkspaceTheme.Provider>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

function change(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function click(label: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
}

async function team(language: "en" | "ur" = "en") {
  await screen.findByRole("option", { name: area.name });
  change(language === "ur" ? "کام کا عنوان" : "Task title", "Clean the washroom");
  change(language === "ur" ? "علاقے کا سانچہ" : "Area template", String(area.id));
  click(language === "ur" ? "اگلا" : "Next");
}

function fillTimes(language: "en" | "ur" = "en") {
  change(language === "ur" ? "لاگو ہونے کی تاریخ" : "Effective from", date);
  change(language === "ur" ? /شروع ہونے کا وقت/ : /Start time/, "09:00");
  change(language === "ur" ? /ختم ہونے کا وقت/ : /End time/, "10:00");
}

function selectOnly(names: string[]) {
  const picker = screen.getByRole("group", { name: "Repeat on" });
  for (const button of within(picker).getAllByRole("button", { pressed: true })) {
    if (!names.includes(button.getAttribute("aria-label") ?? "")) fireEvent.click(button);
  }
}

function rejectCreate(status: number, code: string) {
  mock.post.mockRejectedValueOnce({
    response: { status, data: { errors: [{ field: "repeatDays", code, message: "Private server text" }] } },
  });
}

beforeEach(() => {
  localStorage.clear();
  mock.getAreas.mockReset().mockResolvedValue([area]);
  mock.post.mockReset().mockResolvedValue({ data: { id: 60 } });
});

it("offers three recurrence choices and sends selected repeat days and end date in canonical wire form", async () => {
  mount();
  await team();
  click("Next");
  const recurrence = screen.getByRole("combobox", { name: "Recurrence" });
  expect(within(recurrence).getAllByRole("option").map(option => option.textContent)).toEqual(["Daily", "Chosen days", "Once"]);
  change("Recurrence", "CHOSEN");
  expect(screen.getByRole("group", { name: "Repeat on" })).toBeInTheDocument();
  selectOnly(["Monday", "Wednesday"]);
  fillTimes();
  change("Repeat until (optional)", "2099-06-30");
  click("Next");
  expect(screen.getByText(`Repeats on Mon, Wed from ${date}`)).toBeInTheDocument();
  click("Create schedule");
  await waitFor(() => expect(mock.post).toHaveBeenCalledWith("/task-template", expect.objectContaining({
    recurringType: "DAILY", repeatDays: ["MON", "WED"], recurringEndDate: new Date("2099-06-30T00:00:00Z"),
  })));
});

it.each([
  { choice: "DAILY", wire: "DAILY" },
  { choice: "CHOSEN", wire: "DAILY" },
  { choice: "ONCE", wire: "ONCE" },
])("omits repeatDays for $choice with every day selected by default", async ({ choice, wire }) => {
  mount();
  await team();
  change("Assign staff", "7");
  click("Next");
  expect(screen.getByRole("combobox", { name: "Recurrence" })).toHaveValue("DAILY");
  change("Recurrence", choice);
  fillTimes();
  click("Next");
  click("Create schedule");
  await waitFor(() => expect(mock.post).toHaveBeenCalledTimes(1));
  const [url, payload] = mock.post.mock.calls[0];
  expect(url).toBe("/task-template");
  expect(payload.recurringType).toBe(wire);
  expect(payload).not.toHaveProperty("repeatDays");
});

it("requires a selected day and associates the error with the picker", async () => {
  mount();
  await team();
  click("Next");
  change("Recurrence", "CHOSEN");
  fillTimes();
  selectOnly([]);
  click("Next");
  expect(screen.getByRole("alert")).toHaveTextContent("Choose at least one day for this schedule.");
  expect(screen.getByRole("group", { name: "Repeat on" })).toHaveAccessibleDescription("Choose at least one day for this schedule.");
  expect(screen.queryByRole("button", { name: "Create schedule" })).not.toBeInTheDocument();
});

it("matches a fixed worker's days when Daily and blocks a chosen day they do not work", async () => {
  mount("en", ["MON", "WED"]);
  await team();
  change("Assign staff", "7");
  click("Next");
  expect(screen.getByRole("combobox", { name: "Recurrence" })).toHaveValue("CHOSEN");
  const picker = screen.getByRole("group", { name: "Repeat on" });
  expect(within(picker).getAllByRole("button", { pressed: true }).map(button => button.getAttribute("aria-label"))).toEqual(["Monday", "Wednesday"]);
  expect(screen.getByText("Matched to Sam's work days.")).toBeInTheDocument();
  fillTimes();
  click("Tuesday");
  click("Next");
  expect(picker).toHaveAccessibleDescription("Sam works Mon, Wed. Choose days within those, or use automatic assignment.");
  expect(screen.queryByRole("button", { name: "Create schedule" })).not.toBeInTheDocument();
  click("Tuesday");
  click("Next");
  expect(screen.getByText(`Repeats on Mon, Wed from ${date}`)).toBeInTheDocument();
});

it("translates the option, worker match, days, review and server 422 in Urdu", async () => {
  rejectCreate(422, "SCHEDULE_OUTSIDE_WORK_DAYS");
  mount("ur", ["MON", "WED"]);
  await team("ur");
  change("کارکن مقرر کریں", "7");
  click("اگلا");
  expect(screen.getByRole("option", { name: "منتخب دن", selected: true })).toBeInTheDocument();
  const pickerName = "دہرائے جانے کے دن";
  expect(within(screen.getByRole("group", { name: pickerName })).getByRole("button", { name: "پیر", pressed: true })).toBeInTheDocument();
  expect(screen.getByText("Sam کے کام کے دن منتخب کر دیے گئے ہیں۔")).toBeInTheDocument();
  fillTimes("ur");
  click("اگلا");
  expect(screen.getByText(`${date} سے پیر، بدھ کو دہرایا جاتا ہے`)).toBeInTheDocument();
  click("شیڈول بنائیں");
  expect(await screen.findByRole("group", { name: pickerName })).toHaveAccessibleDescription(
    "Sam کے کام کے دن پیر، بدھ ہیں۔ انہی میں سے دن منتخب کریں یا خودکار تعیناتی استعمال کریں۔",
  );
  expect(screen.queryByText("Private server text")).not.toBeInTheDocument();
});

it("shows translated invalid-repeat feedback and preserves the draft after a server 400", async () => {
  rejectCreate(400, "INVALID_REPEAT_DAYS");
  mount();
  await team();
  click("Next");
  change("Recurrence", "CHOSEN");
  selectOnly(["Monday"]);
  fillTimes();
  click("Next");
  click("Create schedule");
  const picker = await screen.findByRole("group", { name: "Repeat on" });
  expect(picker).toHaveAccessibleDescription("Choose at least one day for this schedule.");
  expect(within(picker).getByRole("button", { name: "Monday", pressed: true })).toBeInTheDocument();
  expect(screen.queryByText("Private server text")).not.toBeInTheDocument();
});
