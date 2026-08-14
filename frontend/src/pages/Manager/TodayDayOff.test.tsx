import { configureStore } from "@reduxjs/toolkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import authReducer from "@/store/slices/authSlice";
import TodayStatusPage from "./TodayStatusPage";
import type { OperationOverview, OperationStaff } from "./operations";

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/api/client", () => ({ client: { get: api.get } }));

const site = { id: 1, name: "Synthetic site", timezone: "Asia/Karachi" };
const asOf = "2026-11-22T02:00:00Z";
const dayOffRow = {
  id: 2,
  name: "Synthetic worker",
  location: site,
  localDate: "2026-11-22",
  carryOver: false,
  attendance: null,
  attendances: [],
  tasks: [],
  taskCount: 0,
  submittedCount: 0,
  offToday: true,
};
const overview: OperationOverview = {
  asOf,
  date: "today",
  locations: [site],
  selected: [site],
  days: [{ locationId: site.id, localDate: dayOffRow.localDate, timezone: site.timezone }],
  metrics: { present: 0, scheduled: 0, totalStaff: 1, totalTasks: 0, submitted: 0, reviewCount: 0, verified: 0, accepted: 0 },
  chart: { submitted: 0, inProgress: 0, notStarted: 0, overdue: 0 },
  attention: [],
  tasks: [],
  comparison: [],
};

function mount(row: OperationStaff = dayOffRow, language = "en") {
  localStorage.setItem("hygene-ops.language", language);
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) => ({
    data: {
      data: url.endsWith("/overview") ? overview : {
        asOf, locations: [site], rows: [row], total: 1, page: 1, pageSize: 20, totalPages: 1,
      },
    },
  }));
  const store = configureStore({ reducer: { auth: authReducer } });
  const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const router = createMemoryRouter([{ path: "/today-status", element: <TodayStatusPage /> }], {
    initialEntries: ["/today-status?tab=staff"],
  });
  render(
    <Provider store={store}>
      <QueryClientProvider client={query}>
        <LanguageProvider>
          <RouterProvider router={router} />
        </LanguageProvider>
      </QueryClientProvider>
    </Provider>,
  );
  return router;
}

const findWorkerRow = () => screen.findByRole("row", { name: /Synthetic worker/ });

it("shows Day off in Attendance and leaves Check-in empty for a day off without a record", async () => {
  mount();
  const cells = within(await findWorkerRow()).getAllByRole("cell");
  expect(cells[2]).toHaveAccessibleName("");
  expect(cells[3]).toHaveAccessibleName("Day off");
});

it("shows the existing attendance status and check-in time for an overnight record on a day off", async () => {
  const checkInTime = "2026-11-21T19:00:00Z";
  mount({
    ...dayOffRow,
    carryOver: true,
    attendance: {
      id: 3,
      status: "CHECKED_IN",
      expectedStart: checkInTime,
      expectedEnd: "2026-11-22T03:00:00Z",
      checkInTime,
      checkOutTime: null,
    },
  });
  const cells = within(await findWorkerRow()).getAllByRole("cell");
  expect(within(cells[2]).getByRole("time")).toHaveAttribute("datetime", checkInTime);
  expect(cells[3]).toHaveAccessibleName("Present");
});

it("puts Day off after No attendance record and sends the off filter through the URL and staff API", async () => {
  const router = mount();
  const chips = within(screen.getByRole("group", { name: "Attendance" }));
  const off = chips.getByRole("button", { name: "Day off" });
  expect(chips.getAllByRole("button").slice(-2)).toEqual([
    chips.getByRole("button", { name: "No attendance record" }),
    off,
  ]);
  fireEvent.click(off);
  expect(new URLSearchParams(router.state.location.search).get("attendance")).toBe("off");
  expect(off).toHaveAttribute("aria-pressed", "true");
  await waitFor(() => expect(api.get).toHaveBeenCalledWith("/manager/operations/staff", expect.objectContaining({
    params: expect.objectContaining({ attendance: "off" }),
  })));
});

it("translates the Day off status and chip into Urdu", async () => {
  mount(dayOffRow, "ur");
  expect(within(await findWorkerRow()).getByRole("cell", { name: "چھٹی کا دن" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "چھٹی کا دن" })).toBeInTheDocument();
});
