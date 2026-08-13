import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import type { Language } from "@/i18n/translations";
import { WEEKDAYS } from "@/lib/workDays";
import StaffScheduleTab from "@/pages/Staff/StaffScheduleTab";
import type { LocationStaff, TaskTemplate } from "../types";
import LocationTemplatesTab from "./LocationTemplatesTab";

const { edit, assign } = vi.hoisted(() => ({ edit: vi.fn(), assign: vi.fn() }));
vi.mock("@/pages/Task/queries", () => ({
  useEditTaskTemplate: () => ({ mutate: edit }),
  useDeleteTaskTemplate: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/pages/Assignment/queries", () => ({
  useAssignStaffToTemplate: () => ({ mutate: assign }),
}));
vi.mock("@/pages/Area/api", () => ({ getAreas: vi.fn().mockResolvedValue([]), getArea: vi.fn() }));

const staff: LocationStaff = {
  id: 7,
  name: "Amina",
  email: null,
  shiftStart: null,
  shiftEnd: null,
  workDays: ["MON", "WED"],
  isActive: true,
};
const chosen = {
  id: 1,
  title: "Hall cleaning",
  recurringType: "DAILY",
  repeatDays: ["MON", "WED"],
  staffId: staff.id,
  shiftStart: "2026-11-09T04:00:00Z",
  shiftEnd: "2026-11-09T05:00:00Z",
  effectiveDate: "2026-11-09T00:00:00Z",
  isActive: true,
} satisfies TaskTemplate;
const dailyHelp = "Daily schedules include every day, including weekends.";

function mount(node: ReactNode, language: Language = "en") {
  localStorage.setItem("hygene-ops.language", language);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter initialEntries={["/locations/20?tab=templates&week=2026-11-09"]}>
          <div className="workspace">{node}</div>
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

function locationTab(template: TaskTemplate) {
  return <LocationTemplatesTab templates={[template]} staffList={[staff]} locationId={20} timeZone="Asia/Karachi" locationName="Saved site" />;
}

function openEditor(editLabel = "Edit schedule") {
  fireEvent.click(screen.getByRole("button", { name: /Hall cleaning/ }));
  fireEvent.click(screen.getByRole("button", { name: editLabel }));
  return within(screen.getByRole("dialog"));
}

beforeEach(() => {
  localStorage.clear();
  edit.mockReset().mockImplementation((_input, callbacks) => callbacks.onSuccess({}));
  assign.mockReset();
});

it.each([
  { language: "en", weekName: "Week", summary: "Mon, Wed" },
  { language: "ur", weekName: "ہفتہ", summary: "پیر، بدھ" },
] as const)("shows the chosen days in the location list and week and in the staff table in $language", ({ language, weekName, summary }) => {
  mount(
    <>
      {locationTab(chosen)}
      <StaffScheduleTab staff={{ taskTemplates: [chosen] }} />
    </>,
    language,
  );
  expect(screen.getByRole("button", { name: /Hall cleaning/ })).toHaveTextContent(summary);
  expect(screen.getAllByRole("table")).toHaveLength(1);
  expect(within(screen.getByRole("table")).getByText(summary)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: weekName }));
  const grid = within(screen.getByRole("table", { name: weekName }));
  expect(grid.getByRole("rowheader")).toHaveTextContent(summary);
  const cells = grid.getAllByRole("cell");
  expect(cells).toHaveLength(7);
  for (const [index, cell] of cells.entries()) {
    const day = within(cell);
    if (index === 0 || index === 2) {
      expect(day.getByRole("button", { name: /Hall cleaning/ })).toHaveTextContent("09:00");
    } else {
      expect(day.queryByRole("button")).not.toBeInTheDocument();
    }
  }
});

it.each([{ repeatDays: undefined }, { repeatDays: [...WEEKDAYS] }, { repeatDays: [] }])("keeps the Every day label and seven occurrences for every-day data (%j)", ({ repeatDays }) => {
  const everyDayStaff = { ...staff, workDays: [...WEEKDAYS] };
  mount(<LocationTemplatesTab templates={[{ ...chosen, repeatDays }]} staffList={[everyDayStaff]}
    locationId={20} timeZone="Asia/Karachi" locationName="Saved site" />);
  expect(screen.getByRole("button", { name: /Hall cleaning/ })).toHaveTextContent("Every day");
  fireEvent.click(screen.getByRole("button", { name: "Week" }));
  const grid = within(screen.getByRole("table", { name: "Week" }));
  expect(grid.getAllByRole("button", { name: /09:00 Hall cleaning/ })).toHaveLength(7);
});

it("opens on the saved chosen days and leaves them out of an unrelated edit", async () => {
  mount(locationTab(chosen));
  const editor = openEditor();
  expect(editor.getByRole("combobox", { name: "Recurrence" })).toHaveValue("CHOSEN");
  expect(editor.queryByText(dailyHelp)).not.toBeInTheDocument();
  expect(editor.getByText("Repeat on", { exact: true })).toBeVisible();
  const picker = within(editor.getByRole("group", { name: "Repeat on" }));
  expect(picker.getAllByRole("button", { pressed: true }).map(button => button.textContent)).toEqual(["Mon", "Wed"]);
  fireEvent.change(editor.getByRole("textbox", { name: "Schedule title" }), { target: { value: "Updated hall" } });
  fireEvent.click(editor.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(edit.mock.calls[0][0]).toEqual({ id: chosen.id, data: { title: "Updated hall" } });
});

it("sends changed days in weekday order with the DAILY wire value", async () => {
  mount(locationTab(chosen));
  const editor = openEditor();
  fireEvent.click(editor.getByRole("button", { name: "Tuesday", pressed: false }));
  fireEvent.click(editor.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(edit.mock.calls[0][0]).toEqual({ id: chosen.id, data: { recurringType: "DAILY", repeatDays: ["MON", "TUE", "WED"] } });
});

it("can return chosen days to Daily and sends all seven days", async () => {
  mount(locationTab(chosen));
  const editor = openEditor();
  fireEvent.change(editor.getByRole("combobox", { name: "Recurrence" }), { target: { value: "DAILY" } });
  expect(editor.getByText(dailyHelp)).toBeInTheDocument();
  expect(editor.queryByRole("group", { name: "Repeat on" })).not.toBeInTheDocument();
  fireEvent.click(editor.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(edit.mock.calls[0][0]).toEqual({ id: chosen.id, data: { recurringType: "DAILY", repeatDays: [...WEEKDAYS] } });
});

it("can switch to Once without sending repeat days", async () => {
  mount(locationTab(chosen));
  const editor = openEditor();
  fireEvent.change(editor.getByRole("combobox", { name: "Recurrence" }), { target: { value: "ONCE" } });
  expect(editor.queryByText(dailyHelp)).not.toBeInTheDocument();
  fireEvent.click(editor.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(edit.mock.calls[0][0]).toEqual({ id: chosen.id, data: { recurringType: "ONCE" } });
});

it("keeps the Once label and one bar even when repeat days are present", () => {
  mount(locationTab({ ...chosen, recurringType: "ONCE", repeatDays: ["FRI"] }));
  expect(screen.getByRole("button", { name: /Hall cleaning/ })).toHaveTextContent("Once");
  fireEvent.click(screen.getByRole("button", { name: "Week" }));
  const grid = within(screen.getByRole("table", { name: "Week" }));
  expect(grid.getAllByRole("button", { name: /09:00 Hall cleaning/ })).toHaveLength(1);
});

it("shows all seven previous days when entering Chosen days from Daily", () => {
  mount(locationTab({ ...chosen, repeatDays: undefined }));
  const editor = openEditor();
  fireEvent.change(editor.getByRole("combobox", { name: "Recurrence" }), { target: { value: "CHOSEN" } });
  const picker = within(editor.getByRole("group", { name: "Repeat on" }));
  expect(picker.getAllByRole("button", { pressed: true })).toHaveLength(7);
  fireEvent.click(editor.getByRole("button", { name: "Save changes" }));
  expect(edit).not.toHaveBeenCalled();
});

it("keeps an empty draft and ties the local error to the picker", () => {
  mount(locationTab(chosen));
  const editor = openEditor();
  const picker = editor.getByRole("group", { name: "Repeat on" });
  for (const button of within(picker).getAllByRole("button", { pressed: true })) fireEvent.click(button);
  fireEvent.click(editor.getByRole("button", { name: "Save changes" }));
  expect(picker).toHaveAttribute("aria-invalid", "true");
  expect(picker).toHaveAccessibleDescription("Choose at least one day for this schedule.");
  expect(edit).not.toHaveBeenCalled();
});

it.each([
  { status: 400, code: "INVALID_REPEAT_DAYS", message: "اس کام کے لیے کم از کم ایک دن منتخب کریں۔" },
  { status: 422, code: "SCHEDULE_OUTSIDE_WORK_DAYS", message: "Amina کے کام کے دن پیر، بدھ ہیں۔ انہی میں سے دن منتخب کریں یا خودکار تعیناتی استعمال کریں۔" },
])("translates a server $status and keeps the selected days", async ({ status, code, message }) => {
  const raw = "Raw server details";
  edit.mockImplementationOnce((_input, callbacks) => callbacks.onError({
    response: { status, data: { message: raw, errors: [{ code, field: "repeatDays", message: raw }] } },
  }));
  mount(locationTab(chosen), "ur");
  const editor = openEditor("شیڈول بدلیں");
  fireEvent.click(editor.getByRole("button", { name: "منگل", pressed: false }));
  fireEvent.click(editor.getByRole("button", { name: "تبدیلیاں محفوظ کریں" }));
  expect(await editor.findByRole("alert")).toHaveTextContent(message);
  expect(editor.getByRole("group", { name: "دہرائے جانے کے دن" })).toHaveAccessibleDescription(message);
  expect(editor.getByRole("button", { name: "منگل", pressed: true })).toBeInTheDocument();
  expect(editor.queryByText(raw)).not.toBeInTheDocument();
});
