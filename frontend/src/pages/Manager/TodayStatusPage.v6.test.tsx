import { configureStore } from "@reduxjs/toolkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import authReducer, { setUser } from "@/store/slices/authSlice";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import TodayStatusPage from "./TodayStatusPage";
import type { OperationOverview, OperationStaff, OperationTask } from "./operations";

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/api/client", () => ({ client: { get: api.get } }));
const site = { id: 1, name: "Synthetic clinic", timezone: "Asia/Karachi" };
const base = { locations: [site], selected: [site], days: [{ locationId: 1, localDate: "2026-10-20", timezone: site.timezone }], asOf: "2026-10-20T03:00:00Z", date: "today" };
function task(overrides: Partial<OperationTask> = {}): OperationTask {
  return { id: 11, title: "Synthetic cleaning", areaNameSnapshot: "Synthetic room", location: site, locationId: 1,
    shiftStart: "2026-10-20T04:00:00Z", shiftEnd: "2026-10-20T05:00:00Z", status: "PENDING", rawStatus: "PENDING",
    staffSubmittedAt: null, verificationVersion: 2, verificationState: "NOT_STARTED", completionOutcome: null,
    staffId: 2, staff: { id: 2, name: "Synthetic worker" }, templateId: 9, carryOver: false, verificationException: null, ...overrides };
}
function worker(overrides: Partial<OperationStaff> = {}): OperationStaff {
  return { id: 2, name: "Synthetic worker", location: site, localDate: "2026-10-20", carryOver: true,
    attendance: { id: 3, status: "LATE", expectedStart: "2026-10-19T18:00:00Z", expectedEnd: "2026-10-20T05:00:00Z", checkInTime: "2026-10-19T18:10:00Z", checkOutTime: null },
    attendances: [], tasks: [task({ status: "IN_PROGRESS", rawStatus: "IN_PROGRESS" })], taskCount: 4, submittedCount: 1, ...overrides };
}
let summary: OperationOverview;
let rows: OperationTask[];
let workers: OperationStaff[];
let detail: OperationTask;
function respond(url: string, options?: { params?: Record<string, string> }) {
  const params = options?.params ?? {};
  if (url.endsWith("/overview")) return summary;
  if (url.endsWith("/qr")) return { taskId: 11, title: detail.title, areaName: "Synthetic room", shiftStart: detail.shiftStart, shiftEnd: detail.shiftEnd, timezone: site.timezone, payload: "synthetic-task-only-code" };
  if (url.startsWith("/task-instance/")) return detail;
  return { ...base, rows: url.endsWith("/staff") ? workers : rows, total: 40, page: Number(params.page || 1), pageSize: Number(params.pageSize || 20), totalPages: 2 };
}
function mount(path = "/today-status", language = "en", role: "ADMIN" | "MANAGER" = "MANAGER") {
  localStorage.setItem("hygene-ops.language", language);
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ id: 1, companyId: 1, role, name: "Synthetic operator", email: "operator@example.invalid" }));
  const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const router = createMemoryRouter([{ path: "/today-status", element: <TodayStatusPage /> }], { initialEntries: [path] });
  render(<Provider store={store}><QueryClientProvider client={query}><LanguageProvider><div className="workspace"><RouterProvider router={router} /></div></LanguageProvider></QueryClientProvider></Provider>);
  return { router, query };
}
const register = () => screen.getByRole("region", { name: "Daily records" });
const panel = () => screen.getByRole("region", { name: "Task details" });
const request = (kind: string, params: Record<string, string>) => expect(api.get).toHaveBeenCalledWith(`/manager/operations/${kind}`, expect.objectContaining({ params: expect.objectContaining(params), signal: expect.any(AbortSignal) }));
beforeEach(() => {
  localStorage.clear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  rows = [task()]; workers = [worker()]; detail = task();
  summary = { ...base, metrics: { present: 18, scheduled: 20, totalStaff: 24, totalTasks: 40, submitted: 26, reviewCount: 4, verified: 3, accepted: 1 }, chart: { submitted: 26, inProgress: 2, notStarted: 9, overdue: 3 }, attention: [], tasks: rows, comparison: [{ location: site, present: 18, scheduled: 20, tasks: 40, submitted: 26, reviews: 4 }] };
  api.get.mockReset(); api.get.mockImplementation(async (url, options) => ({ data: { data: respond(url, options) } }));
});

it("adopts summary and both charts without changing overview scope or cache inputs", async () => {
  mount("/today-status?locationId=1&date=2026-10-20&workerId=2&page=2");
  expect(await screen.findByRole("heading", { name: "Work through the day" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "By location" })).toBeInTheDocument();
  request("overview", { locationId: "1", date: "2026-10-20" });
  request("tasks", { locationId: "1", date: "2026-10-20", workerId: "2", page: "2" });
  expect(api.get.mock.calls.some(([url]) => url.endsWith("/staff"))).toBe(false);
});
it("tabs write URL scope, clear stale table filters, and request server staff data", async () => {
  const { router } = mount("/today-status?date=2026-10-20&locationId=1&q=old&status=overdue&page=2&taskId=11");
  fireEvent.mouseDown(await screen.findByRole("tab", { name: "Staff" }), { button: 0, ctrlKey: false });
  await waitFor(() => request("staff", { locationId: "1", date: "2026-10-20" }));
  expect(new URLSearchParams(router.state.location.search).get("tab")).toBe("staff");
  for (const key of ["page", "status", "taskId", "q"]) expect(new URLSearchParams(router.state.location.search).has(key)).toBe(false);
  expect(await screen.findByRole("tabpanel", { name: "Staff 40" })).toBeInTheDocument();
});
it("status chips use aggregate counts, preserve scope and other filters, and reset page", async () => {
  const { router } = mount("/today-status?date=2026-10-20&locationId=1&page=2&workerId=2&extra=keep");
  await screen.findByRole("button", { name: /Overdue\s*3/ });
  fireEvent.click(screen.getByRole("button", { name: /Overdue\s*3/ }));
  await waitFor(() => request("tasks", { status: "overdue", locationId: "1", date: "2026-10-20", workerId: "2" }));
  expect(router.state.location.search).toContain("extra=keep"); expect(router.state.location.search).not.toContain("page=");
  expect(screen.getByRole("button", { name: /Overdue\s*3/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Unassigned work" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /All tasks\s*40/ })).toBeInTheDocument();
});
it("search writes URL immediately and debounces only the server search", async () => {
  const { router } = mount("/today-status?locationId=1&date=2026-10-20&page=2");
  const input = await screen.findByRole("searchbox", { name: "Find a task" });
  fireEvent.change(input, { target: { value: "room" } });
  fireEvent.change(input, { target: { value: "room east" } });
  expect(new URLSearchParams(router.state.location.search).get("q")).toBe("room east");
  expect(router.state.location.search).not.toContain("page=");
  await waitFor(() => request("tasks", { q: "room east", locationId: "1", date: "2026-10-20" }));
  expect(api.get.mock.calls.some(([url, options]) => url.endsWith("/tasks") && options.params.q === "room")).toBe(false);
});
it("server pagination requests the next page and retains filters", async () => {
  const { router } = mount("/today-status?locationId=1&date=2026-10-20&q=room&status=all");
  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  await waitFor(() => request("tasks", { page: "2", q: "room", status: "all", locationId: "1", date: "2026-10-20" }));
  expect(router.state.location.search).toContain("page=2");
  expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
});
it("page-size changes reset server page and keep the rest of the URL", async () => {
  const { router } = mount("/today-status?page=2&status=submitted&locationId=1");
  fireEvent.change(await screen.findByRole("combobox", { name: "Per page" }), { target: { value: "50" } });
  await waitFor(() => request("tasks", { pageSize: "50", status: "submitted", locationId: "1" }));
  expect(router.state.location.search).not.toContain("page=");
});
it("the server's clamped page replaces the URL while retaining task and filters", async () => {
  api.get.mockImplementation(async (url, options) => ({ data: { data: url.endsWith("/tasks") ? { ...respond(url, options), page: 1 } : respond(url, options) } }));
  const { router } = mount("/today-status?page=999&taskId=11&status=all");
  await waitFor(() => expect(new URLSearchParams(router.state.location.search).get("page")).toBe("1"));
  expect(router.state.location.search).toContain("taskId=11"); expect(router.state.location.search).toContain("status=all");
});
it("clicking an ordinary row sets taskId, opens inline details, and preserves the register URL", async () => {
  const { router } = mount("/today-status?page=2&status=all&locationId=1&date=2026-10-20&q=room");
  const row = (await screen.findByRole("link", { name: "Open task: Synthetic room" })).closest("tr")!;
  fireEvent.click(within(row).getByText("Synthetic room"));
  expect(await screen.findByRole("region", { name: "Task details" })).toBeInTheDocument();
  await within(panel()).findByRole("link", { name: "View task photos" });
  const params = new URLSearchParams(router.state.location.search);
  expect(Object.fromEntries(params)).toMatchObject({ taskId: "11", page: "2", status: "all", locationId: "1", date: "2026-10-20", q: "room", tab: "tasks" });
  expect(register()).toBeInTheDocument(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("a taskId deep link loads the task even if it is not on the current page", async () => {
  rows = [];
  mount("/today-status?taskId=11&status=overdue");
  expect(await within(await screen.findByRole("region", { name: "Task details" })).findByRole("link", { name: "View task photos" })).toHaveAttribute("href", "/verification/11");
  expect(api.get).toHaveBeenCalledWith("/task-instance/11", expect.objectContaining({ signal: expect.any(AbortSignal) }));
});
it("panel focuses its heading, Escape closes it and restores the opener", async () => {
  const { router } = mount("/today-status?page=2&status=all");
  const open = await screen.findByRole("link", { name: "Open task: Synthetic room" }); open.focus(); fireEvent.click(open);
  const heading = await screen.findByRole("heading", { name: "Task details" });
  await waitFor(() => expect(heading).toHaveFocus());
  fireEvent.keyDown(heading, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("region", { name: "Task details" })).not.toBeInTheDocument());
  await waitFor(() => expect(open).toHaveFocus());
  expect(router.state.location.search).toContain("page=2"); expect(router.state.location.search).not.toContain("taskId");
});
it("panel shows submitted, verified and review closure as independent records", async () => {
  detail = task({ staffSubmittedAt: "2026-10-20T04:45:00Z", status: "COMPLETED", completionOutcome: "VERIFIED_COMPLETE", verificationState: "VERIFIED", verificationException: { id: 31, state: "RESOLVED" } });
  mount("/today-status?taskId=11");
  const region = await screen.findByRole("region", { name: "Task details" }); await within(region).findByText("Review closed");
  for (const [label, value] of [["Submitted", "Work submitted"], ["Verified", "Verified completion recorded"], ["Review status", "Review closed"]]) {
    expect(within(region).getByText(label, { selector: "dt" }).nextElementSibling).toHaveTextContent(value);
  }
  expect(within(region).getByRole("link", { name: "Review" })).toHaveAttribute("href", "/exceptions/31");
  expect(within(region).queryByRole("button", { name: "Task QR" })).not.toBeInTheDocument();
});
it("closed review never implies a submission or verified completion", async () => {
  detail = task({ verificationState: "NEEDS_REVIEW", verificationException: { id: 31, state: "RESOLVED" } });
  mount("/today-status?taskId=11");
  const region = await screen.findByRole("region", { name: "Task details" });
  expect(await within(region).findByText("Verified completion not recorded")).toBeInTheDocument();
  expect(within(region).getByText("Not submitted")).toBeInTheDocument(); expect(within(region).getByText("Review closed")).toBeInTheDocument();
});
it("accepted exceptions and open review do not become verified", async () => {
  detail = task({ staffSubmittedAt: "2026-10-20T04:45:00Z", completionOutcome: "COMPLETED_WITH_EXCEPTIONS", verificationState: "VERIFIED", verificationException: { id: 31, state: "OPEN" } });
  mount("/today-status?taskId=11");
  const region = await screen.findByRole("region", { name: "Task details" });
  expect(await within(region).findByText("Accepted with exceptions")).toBeInTheDocument();
  expect(within(region).getByText("Needs manager")).toBeInTheDocument(); expect(within(region).queryByText("Verified completion recorded")).not.toBeInTheDocument();
});
it("Task QR is fetched only on opening it and schedule links remain available for assigned tasks", async () => {
  mount("/today-status?taskId=11");
  const qr = await within(await screen.findByRole("region", { name: "Task details" })).findByRole("button", { name: "Task QR" });
  expect(api.get.mock.calls.some(([url]) => url.endsWith("/qr"))).toBe(false);
  expect(within(panel()).getByRole("link", { name: "Open cleaning schedule" })).toHaveAttribute("href", "/locations/1?tab=templates#schedule-9");
  fireEvent.click(qr);
  expect(await within(panel()).findByRole("button", { name: "Print task QR" })).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("/task-instance/11/qr", expect.objectContaining({ signal: expect.any(AbortSignal) }));
});
it("unassigned work keeps the explicit label and previous-assignment history", async () => {
  rows = [task({ staffId: null, staff: null, assignments: [{ staffId: 8, staff: { id: 8, name: "Synthetic previous worker" }, isCurrent: false, status: "REASSIGNED" }] })];
  mount();
  const table = await screen.findByRole("table");
  expect(within(table).getByText("Unassigned")).toBeInTheDocument();
  expect(within(table).getByText("Synthetic previous worker")).toBeInTheDocument();
  expect(within(table).getByText(/Previously assigned/)).toBeInTheDocument();
});
it("staff keeps location, shift, check-in, overnight, submitted figures and worker deep link", async () => {
  mount("/today-status?tab=staff&attendance=present&locationId=1&date=2026-10-20");
  const table = await screen.findByRole("table");
  expect(within(table).getByText("Started yesterday · overnight shift")).toBeInTheDocument();
  expect(within(table).getByText("Late check-in")).toBeInTheDocument();
  expect(within(table).getByText(/Work submitted:/)).toBeInTheDocument();
  expect(within(table).getByRole("link", { name: "View worker" })).toHaveAttribute("href", "/staff/2?dateFrom=2026-10-20&dateTo=2026-10-20&tab=overview&focus=today");
  expect(within(table).getByRole("link", { name: "Synthetic room" })).toHaveAttribute("href", expect.stringContaining("taskId=11"));
  request("staff", { attendance: "present", locationId: "1", date: "2026-10-20" });
});
it("all six attendance filters stay reachable and write the URL", async () => {
  const { router } = mount("/today-status?tab=staff&page=2");
  const group = await screen.findByRole("group", { name: "Attendance" });
  expect(within(group).getAllByRole("button")).toHaveLength(6);
  fireEvent.click(within(group).getByRole("button", { name: "No attendance record" }));
  await waitFor(() => request("staff", { attendance: "missing" }));
  expect(router.state.location.search).toContain("attendance=missing"); expect(router.state.location.search).not.toContain("page=");
});
it("future absent shift is upcoming while a missing attendance record remains distinct", async () => {
  workers = [worker({ carryOver: false, attendance: { id: 3, status: "ABSENT", expectedStart: "2026-10-20T04:00:00Z", expectedEnd: "2026-10-20T05:00:00Z", checkInTime: null, checkOutTime: null } }), worker({ id: 9, name: "Synthetic unscheduled worker", carryOver: false, attendance: null })];
  mount("/today-status?tab=staff");
  const table = await screen.findByRole("table");
  expect(within(table).getByText("Shift not started")).toBeInTheDocument();
  expect(within(table).getAllByText("No attendance record")).toHaveLength(2);
  expect(within(table).getAllByText("Not recorded")).toHaveLength(2);
});
it("previous/next day and Today use snapshot-local dates, preserving filters and clearing page/task", async () => {
  const { router } = mount("/today-status?locationId=1&page=2&taskId=11&status=all&q=room");
  await screen.findByRole("table");
  expect(screen.getByRole("button", { name: "Next day" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
  await waitFor(() => request("tasks", { date: "2026-10-19", locationId: "1", q: "room", status: "all" }));
  expect(router.state.location.search).not.toMatch(/page=|taskId=/);
  await waitFor(() => expect(screen.getByRole("button", { name: "Next day" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Next day" }));
  await waitFor(() => expect(router.state.location.search).toContain("date=2026-10-20"));
  fireEvent.click(within(screen.getByRole("group", { name: "Date" })).getByRole("button", { name: "Today" }));
  await waitFor(() => expect(router.state.location.search).toContain("date=today"));
});
it("day arithmetic crosses year boundaries without converting the selected local day", async () => {
  mount("/today-status?date=2026-01-01");
  await screen.findByRole("table"); fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
  await waitFor(() => request("tasks", { date: "2025-12-31" }));
});
it("location selection keeps existing scope-control reset and preservation behavior", async () => {
  const { router } = mount("/today-status?locationId=1&page=2&taskId=11&status=overdue&date=2026-10-20");
  fireEvent.keyDown(await screen.findByRole("button", { name: /Location: Synthetic clinic/ }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "My assigned locations" }));
  await waitFor(() => expect(router.state.location.search).not.toContain("locationId"));
  expect(router.state.location.search).toContain("status=overdue"); expect(router.state.location.search).not.toMatch(/page=|taskId=/);
});
it("loading uses announced skeletons without fabricated totals or actions", () => {
  api.get.mockImplementation(() => new Promise(() => {})); mount();
  expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
  expect(screen.queryByRole("heading", { name: "Team attendance" })).not.toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
});
it("initial summary/table failures retry independently with saved-record reassurance", async () => {
  let failed = true; api.get.mockImplementation(async (url, options) => { if (failed) throw new Error("Synthetic offline"); return { data: { data: respond(url, options) } }; });
  mount();
  await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
  expect(screen.getAllByRole("alert")[0]).toHaveTextContent("Your saved records have not changed");
  failed = false;
  fireEvent.click(within(screen.getAllByRole("alert")[0]).getByRole("button", { name: "Retry" }));
  await screen.findByRole("heading", { name: "Team attendance" });
  fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("table")).toBeInTheDocument();
});
it("background failures retain summary, chart, table, selected panel, drafts and focus", async () => {
  const { query } = mount("/today-status?taskId=11&q=room");
  const input = await screen.findByRole("searchbox", { name: "Find a task" });
  await within(await screen.findByRole("region", { name: "Task details" })).findByRole("link", { name: "View task photos" });
  input.focus(); api.get.mockRejectedValue(new Error("Synthetic background failure"));
  await act(async () => { await query.refetchQueries(); });
  expect(input).toHaveFocus(); expect(input).toHaveValue("room");
  expect(screen.getByRole("heading", { name: "Team attendance" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Work through the day" })).toBeInTheDocument();
  expect(screen.getByRole("table")).toBeInTheDocument(); expect(within(panel()).getByRole("link", { name: "View task photos" })).toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(3));
});
it("task details failure keeps Close and offers a scoped retry", async () => {
  let failed = true; api.get.mockImplementation(async (url, options) => { if (url.startsWith("/task-instance/") && failed) throw new Error("Synthetic missing details"); return { data: { data: respond(url, options) } }; });
  mount("/today-status?taskId=11");
  const region = await screen.findByRole("region", { name: "Task details" }); await within(region).findByRole("alert");
  expect(within(region).getByRole("button", { name: "Close details" })).toBeInTheDocument();
  failed = false; fireEvent.click(within(region).getByRole("button", { name: "Retry" }));
  expect(await within(region).findByRole("link", { name: "View task photos" })).toBeInTheDocument();
});
it("new-company empty state teaches setup using server emptiness", async () => {
  summary = { ...summary, locations: [], selected: [], days: [], comparison: [] };
  api.get.mockImplementation(async (url, options) => ({ data: { data: url.endsWith("/tasks") ? { ...respond(url, options), rows: [], total: 0, totalPages: 1 } : respond(url, options) } }));
  mount("/today-status", "en", "ADMIN");
  expect(await screen.findByRole("heading", { name: "Nothing is scheduled yet" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Continue setup" })).toHaveAttribute("href", "/setup");
});
it("no-match empty state clears table filters and retains selected scope", async () => {
  api.get.mockImplementation(async (url, options) => ({ data: { data: url.endsWith("/tasks") ? { ...respond(url, options), rows: [], total: 0, totalPages: 1 } : respond(url, options) } }));
  const { router } = mount("/today-status?locationId=1&date=2026-10-20&q=missing&status=overdue");
  expect(await screen.findByText("No tasks match these filters.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(Object.fromEntries(new URLSearchParams(router.state.location.search))).toEqual({ locationId: "1", date: "2026-10-20" });
});
it("Urdu translates controls and separate panel records while preserving configured names", async () => {
  mount("/today-status?taskId=11", "ur");
  const region = await screen.findByRole("region", { name: "کام کی تفصیل" });
  expect(await within(region).findByText("Synthetic room")).toBeInTheDocument();
  expect(within(region).getByText("جمع شدہ", { selector: "dt" })).toBeInTheDocument();
  expect(within(region).getByText("تصدیق شدہ", { selector: "dt" })).toBeInTheDocument();
  expect(document.documentElement.dir).toBe("rtl"); expect(screen.getByRole("button", { name: "پچھلا دن" })).toBeInTheDocument();
});
it("invalid task IDs do not issue detail requests", async () => {
  mount("/today-status?taskId=1.5"); await screen.findByRole("table");
  expect(screen.queryByRole("region", { name: "Task details" })).not.toBeInTheDocument();
  expect(api.get.mock.calls.some(([url]) => url.startsWith("/task-instance/"))).toBe(false);
});
it("cancelled tasks past end time remain cancelled rather than becoming overdue", async () => {
  rows = [task({ status: "CANCELLED", rawStatus: "CANCELLED", shiftEnd: "2026-10-19T05:00:00Z" })];
  mount(); const table = await screen.findByRole("table");
  expect(within(table).getByText("Cancelled")).toBeInTheDocument(); expect(within(table).queryByText("Overdue")).not.toBeInTheDocument();
});

it("pointer row opening returns focus to that task instead of an unrelated search field", async () => {
  mount();
  const open = await screen.findByRole("link", { name: "Open task: Synthetic room" });
  screen.getByRole("searchbox", { name: "Find a task" }).focus();
  fireEvent.click(within(open.closest("tr")!).getByText("Synthetic room"));
  const region = await screen.findByRole("region", { name: "Task details" });
  fireEvent.click(within(region).getByRole("button", { name: "Close details" }));
  await waitFor(() => expect(open).toHaveFocus());
});
