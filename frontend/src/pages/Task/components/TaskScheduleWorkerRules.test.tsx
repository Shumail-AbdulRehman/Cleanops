import { configureStore } from "@reduxjs/toolkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceTheme } from "@/components/common/WorkspaceTheme";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import type { Area } from "@/pages/Area/types";
import LocationTemplatesTab from "@/pages/Location/components/LocationTemplatesTab";
import type { LocationStaff, TaskTemplate } from "@/pages/Location/types";
import authReducer, { setUser } from "@/store/slices/authSlice";
import TaskScheduleWizard from "./TaskScheduleWizard";

const mock = vi.hoisted(() => ({
  areas: vi.fn(),
  subscription: vi.fn(),
  create: vi.fn(),
  edit: vi.fn(),
  assign: vi.fn(),
}));

vi.mock("@/pages/Area/api", () => ({ getAreas: mock.areas }));
vi.mock("@/pages/Subscription/api", () => ({ getSubscription: mock.subscription }));
vi.mock("@/pages/Task/api", () => ({
  createTaskTemplate: mock.create, editTaskTemplate: mock.edit, getTaskTemplate: vi.fn(),
}));
vi.mock("@/pages/Assignment/api", () => ({ assignStaffToTaskTemplate: mock.assign }));

const timeZone = "Asia/Karachi";
const worker: LocationStaff = {
  id: 7, name: "Samira", email: null, shiftStart: null, shiftEnd: null, isActive: true,
};
const replacement = { ...worker, id: 8, name: "Nadia" };
const template: TaskTemplate = {
  id: 42, title: "Lobby cleaning", staffId: worker.id, staff: worker,
  shiftStart: "2026-11-22T03:30:00Z", shiftEnd: "2026-11-22T04:00:00Z",
  effectiveDate: "2026-11-22", recurringType: "DAILY", isActive: true,
};
const area: Area = {
  id: 14, locationId: 20, name: "Lobby", roomType: "GENERAL", status: "ACTIVE",
  inventoryVersion: 2, qrVersion: 1, layoutInstructions: null,
  items: [{
    id: 31, areaId: 14, stableCode: "FLOOR-01", displayName: "Floor", fixtureType: "FLOOR",
    positionHint: null, sequence: 1, identificationMode: "ORDERED_CONTEXT", existingNumber: null,
    status: "ACTIVE", rubricKey: "floor", requiredViews: [{ key: "overview" }],
  }],
};

const copy = {
  en: {
    title: "Task title", area: "Area template", next: "Next", automatic: "Use automatic assignment",
    start: "Start time", end: "End time", create: "Create schedule",
    required: "Your plan does not assign staff automatically. Choose a worker for this schedule.",
    overlap: "Samira already has an overlapping schedule: Morning round. Choose a different time or worker.",
    shift: "This time falls outside Samira's shift (08:00–16:00). Choose a time inside the shift or update the shift.",
  },
  ur: {
    title: "کام کا عنوان", area: "علاقے کا سانچہ", next: "اگلا", automatic: "خودکار تفویض استعمال کریں",
    start: "شروع ہونے کا وقت", end: "ختم ہونے کا وقت", create: "شیڈول بنائیں",
    required: "آپ کے پلان میں عملے کی خودکار تعیناتی کی سہولت نہیں ہے۔ اس شیڈول کے لیے ایک کارکن منتخب کریں۔",
    overlap: "Samira کا ایک شیڈول پہلے سے موجود ہے جس کا وقت اس شیڈول سے ٹکراتا ہے: Morning round۔ کوئی دوسرا وقت یا کارکن منتخب کریں۔",
    shift: "یہ وقت Samira کی شفٹ (08:00–16:00) سے باہر ہے۔ شفٹ کے اندر کوئی وقت منتخب کریں یا شفٹ کے اوقات بدلیں۔",
  },
};
type Language = keyof typeof copy;

function setPlan(automaticAssignment: boolean) {
  mock.subscription.mockResolvedValue({ plan: { features: { automaticAssignment } } });
}

function mount(node: ReactNode, language: Language = "en") {
  localStorage.setItem("hygene-ops.language", language);
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ id: 1, companyId: 10, name: "Owner", email: "owner@example.invalid", role: "ADMIN" }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <Provider store={store}>
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <WorkspaceTheme.Provider value>
            <MemoryRouter>{node}</MemoryRouter>
          </WorkspaceTheme.Provider>
        </LanguageProvider>
      </QueryClientProvider>
    </Provider>,
  );
}

async function openTeam(language: Language = "en") {
  mount(<TaskScheduleWizard locationId={20} locationName="Main site" timeZone={timeZone}
    staffOptions={[worker]} open onOpenChange={vi.fn()} onCreated={vi.fn()} />, language);
  const text = copy[language];
  const wizard = within(screen.getByRole("dialog"));
  await wizard.findByRole("option", { name: "Lobby" });
  fireEvent.change(wizard.getByRole("textbox", { name: text.title }), { target: { value: template.title } });
  fireEvent.change(wizard.getByRole("combobox", { name: text.area }), { target: { value: String(area.id) } });
  fireEvent.click(wizard.getByRole("button", { name: text.next }));
  return wizard;
}

function submitWizard(wizard: Awaited<ReturnType<typeof openTeam>>, language: Language, manual: boolean) {
  const text = copy[language];
  if (manual) fireEvent.change(wizard.getByRole("combobox"), { target: { value: String(worker.id) } });
  fireEvent.click(wizard.getByRole("button", { name: text.next }));
  fireEvent.change(wizard.getByLabelText(text.start, { exact: false }), { target: { value: "08:30" } });
  fireEvent.change(wizard.getByLabelText(text.end, { exact: false }), { target: { value: "09:00" } });
  fireEvent.click(wizard.getByRole("button", { name: text.next }));
  fireEvent.click(wizard.getByRole("button", { name: text.create }));
}

function refusal(status: number, code: string, field: string, message: string) {
  return { response: { status, data: { message: "Unexpected transport message", errors: [{ code, field, message }] } } };
}

function openEdit() {
  mount(<LocationTemplatesTab locationId={20} locationName="Main site" timeZone={timeZone}
    templates={[template]} staffList={[worker, replacement]} />);
  fireEvent.click(screen.getByRole("button", { name: new RegExp(template.title) }));
  fireEvent.click(screen.getByRole("button", { name: "Edit schedule" }));
  return within(screen.getByRole("dialog", { name: "Edit cleaning schedule" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mock.areas.mockResolvedValue([area]);
  setPlan(true);
});

afterEach(() => {
  cleanup();
  localStorage.removeItem("hygene-ops.language");
});

describe("schedule wizard worker rules", () => {
  it.each(["en", "ur"] as const)("requires a Starter worker and explains why in %s", async language => {
    setPlan(false);
    const wizard = await openTeam(language);
    const text = copy[language];
    const select = wizard.getByRole("combobox");
    const next = wizard.getByRole("button", { name: text.next });
    expect(await wizard.findByText(text.required)).toBeVisible();
    expect(select).toHaveAccessibleDescription(text.required);
    expect(wizard.queryByRole("option", { name: text.automatic })).toBeNull();
    expect(next).toBeDisabled();
    fireEvent.change(select, { target: { value: String(worker.id) } });
    expect(next).toBeEnabled();
  });

  it("keeps the automatic option on plans with automatic assignment", async () => {
    const wizard = await openTeam();
    expect(wizard.getByRole("option", { name: copy.en.automatic })).toBeEnabled();
    expect(wizard.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("keeps the automatic option while the plan read is pending", async () => {
    mock.subscription.mockReturnValue(new Promise(() => {}));
    const wizard = await openTeam();
    expect(wizard.getByRole("option", { name: copy.en.automatic })).toBeEnabled();
    expect(wizard.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("uses the server's worker-required code when the plan read fails", async () => {
    mock.subscription.mockRejectedValue(new Error("Subscription unavailable"));
    mock.create.mockRejectedValue(refusal(422, "WORKER_REQUIRED", "staffId", "Unexpected detail message"));
    const wizard = await openTeam();
    submitWizard(wizard, "en", false);
    expect(await wizard.findByRole("alert")).toHaveTextContent(copy.en.required);
    expect(wizard.getByRole("combobox")).toHaveAccessibleDescription(copy.en.required);
    expect(wizard.queryByText(/Automatic assignment remains available/)).toBeNull();
  });

  it.each(["en", "ur"] as const)("shows the overlapping schedule under the worker in %s", async language => {
    mock.create.mockRejectedValue(refusal(409, "WORKER_OVERLAP", "staffId", copy.en.overlap));
    const wizard = await openTeam(language);
    submitWizard(wizard, language, true);
    expect(await wizard.findByRole("alert")).toHaveTextContent(copy[language].overlap);
    expect(wizard.getByRole("combobox")).toHaveAccessibleDescription(copy[language].overlap);
    expect(wizard.getByRole("combobox")).toHaveValue(String(worker.id));
    expect(mock.areas).toHaveBeenCalledTimes(1);
  });

  it.each(["en", "ur"] as const)("shows the worker's shift under start time in %s", async language => {
    mock.create.mockRejectedValue(refusal(422, "SHIFT_MISMATCH", "shiftStart", copy.en.shift));
    const wizard = await openTeam(language);
    submitWizard(wizard, language, true);
    expect(await wizard.findByRole("alert")).toHaveTextContent(copy[language].shift);
    const start = wizard.getByLabelText(copy[language].start, { exact: false });
    expect(start).toHaveAccessibleDescription(copy[language].shift);
    expect(start).toHaveValue("08:30");
  });
});

describe("schedule edit worker rules", () => {
  it("omits Unassigned for an assigned Starter schedule and shows an assign refusal by the worker", async () => {
    setPlan(false);
    const message = copy.en.overlap.replace(worker.name, replacement.name);
    mock.assign.mockRejectedValue(refusal(409, "WORKER_OVERLAP", "staffId", message));
    const editor = openEdit();
    const select = editor.getByRole("combobox", { name: "Assigned staff" });
    fireEvent.change(select, { target: { value: String(replacement.id) } });
    fireEvent.click(editor.getByRole("button", { name: "Save changes" }));
    expect(await editor.findByRole("alert")).toHaveTextContent(message);
    expect(select).toHaveAccessibleDescription(message);
    expect(within(select).queryByRole("option", { name: "Unassigned" })).toBeNull();
    expect(mock.edit).not.toHaveBeenCalled();
  });

  it("shows a schedule edit refusal by start time", async () => {
    mock.edit.mockRejectedValue(refusal(422, "SHIFT_MISMATCH", "shiftStart", copy.en.shift));
    const editor = openEdit();
    const start = editor.getByLabelText("Shift start");
    fireEvent.change(start, { target: { value: "07:30" } });
    fireEvent.click(editor.getByRole("button", { name: "Save changes" }));
    expect(await editor.findByRole("alert")).toHaveTextContent(copy.en.shift);
    expect(start).toHaveAccessibleDescription(copy.en.shift);
    expect(start).toHaveValue("07:30");
    expect(mock.assign).not.toHaveBeenCalled();
  });
});
