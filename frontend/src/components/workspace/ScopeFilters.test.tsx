import { act } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import auth, { setUser } from "@/store/slices/authSlice";
import { LanguageContext } from "@/i18n/context";
import { translate, type Language } from "@/i18n/translations";
import ScopeFilters from "@/components/common/ScopeFilters";
import { dailyLink, type LocationScope } from "@/pages/Manager/operations";

const locations: LocationScope[] = [
  { id: 7, name: "North office", timezone: "Asia/Karachi" },
  { id: 19, name: "Today", timezone: "Pacific/Honolulu" },
];
function setup({ search = "", role = "ADMIN", language = "en", localDate = "2026-11-10", sites = locations }: {
  search?: string; role?: "ADMIN" | "MANAGER"; language?: Language;
  localDate?: string; sites?: LocationScope[];
} = {}) {
  const store = configureStore({ reducer: { auth } });
  store.dispatch(setUser({ id: 1, companyId: 1, role, name: "Test user", email: "fixture@example.invalid" }));
  const router = createMemoryRouter([{
    path: "/today-status", element: <ScopeFilters locations={sites} localDate={localDate || undefined} />,
  }], { initialEntries: [`/today-status${search}`] });
  render(<Provider store={store}><LanguageContext.Provider value={{ language, setLanguage: () => {}, t: (text, values) => translate(text, language, values) }}>
    <div className="workspace" dir={language === "ur" ? "rtl" : "ltr"} lang={language === "ur" ? "ur-PK" : "en-PK"}><RouterProvider router={router} /></div>
  </LanguageContext.Provider></Provider>);
  return { router, params: () => new URLSearchParams(router.state.location.search) };
}
function openLocation(language: Language = "en") {
  fireEvent.keyDown(screen.getByRole("button", { name: new RegExp(`^${translate("Location", language)}:`) }), { key: "ArrowDown" });
}
function openDate(language: Language = "en") {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${translate("Date", language)}:`) }));
}
function dayName(date: string, language: Language = "en") {
  return new Intl.DateTimeFormat(language === "ur" ? "ur-PK" : "en-PK", { dateStyle: "full", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
}

describe("ScopeFilters URL contract", () => {
  it("chooses a location, preserves date and other filters, and clears the page and selected task", () => {
    const { params } = setup({ search: "?date=2026-11-09&tab=tasks&status=OVERDUE&q=lobby&page=3&taskId=12" });
    openLocation();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "North office" }));
    expect(Object.fromEntries(params())).toEqual({ locationId: "7", date: "2026-11-09", tab: "tasks", status: "OVERDUE", q: "lobby" });
    expect(screen.getByRole("button", { name: "Location: North office" })).toBeVisible();
  });

  it.each(["ADMIN", "MANAGER"] as const)("clears locationId for the %s unfiltered scope", role => {
    const { params } = setup({ role, search: "?locationId=7&date=today&tab=staff&page=2&taskId=4" });
    openLocation();
    fireEvent.click(screen.getByRole("menuitemradio", { name: role === "ADMIN" ? "All locations" : "My assigned locations" }));
    expect(Object.fromEntries(params())).toEqual({ date: "today", tab: "staff" });
  });

  it("writes the chosen calendar date and preserves the location and unrelated filters", () => {
    const { params } = setup({ search: "?locationId=19&tab=tasks&status=IN_PROGRESS&page=4&taskId=8" });
    openDate();
    fireEvent.click(screen.getByRole("button", { name: dayName("2026-11-09") }));
    expect(Object.fromEntries(params())).toEqual({ locationId: "19", date: "2026-11-09", tab: "tasks", status: "IN_PROGRESS" });
    expect(screen.getByRole("button", { name: "Date: 9 Nov 2026" })).toBeVisible();
  });

  it.each(["quick choice", "Back to today"])("restores the literal today URL value using %s", action => {
    const { params } = setup({ search: "?locationId=7&date=2026-11-09&page=3&taskId=9&tab=staff" });
    if (action === "quick choice") openDate();
    fireEvent.click(screen.getByRole("button", { name: action === "quick choice" ? "Today" : action }));
    expect(Object.fromEntries(params())).toEqual({ locationId: "7", date: "today", tab: "staff" });
    expect(screen.getByRole("button", { name: "Date: Today" })).toBeVisible();
    expect(screen.getByText("Today in each location")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Back to today" })).not.toBeInTheDocument();
  });

  it.each(["", "?date=today", "?date="])("displays Today without rewriting the initial URL %s", search => {
    const { router } = setup({ search });
    expect(screen.getByRole("button", { name: "Date: Today" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Location: All locations" })).toBeVisible();
    expect(router.state.location.search).toBe(search);
  });

  it("uses the supplied location-local maximum even when the device day is later", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 12, 12));
    try {
      const { params } = setup();
      openDate();
      const future = screen.getByRole("button", { name: dayName("2026-11-11") });
      expect(future).toBeDisabled();
      fireEvent.click(future);
      expect(params().has("date")).toBe(false);
      expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
      const today = screen.getByRole("button", { name: dayName("2026-11-10") });
      expect(today).toHaveAttribute("aria-current", "date");
      expect(today).toBeEnabled();
      fireEvent.click(today);
      expect(params().get("date")).toBe("2026-11-10");
    } finally { vi.useRealTimers(); }
  });

  it("blocks future dates using the device local day when localDate is absent", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 10, 0, 30));
    try {
      setup({ localDate: "" });
      openDate();
      expect(screen.getByRole("button", { name: dayName("2026-11-10") })).toBeEnabled();
      expect(screen.getByRole("button", { name: dayName("2026-11-11") })).toBeDisabled();
    } finally { vi.useRealTimers(); }
  });

  it("writes Yesterday as a concrete local date", () => {
    const { params } = setup();
    openDate();
    fireEvent.click(screen.getByRole("button", { name: "Yesterday" }));
    expect(params().get("date")).toBe("2026-11-09");
  });

  it("offers only the provided assigned locations to a manager, including an empty scope", () => {
    setup({ role: "MANAGER", sites: [] });
    openLocation();
    const items = screen.getAllByRole("menuitemradio");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAccessibleName("My assigned locations");
  });

  it("translates the Urdu interface and portal direction while preserving location record names", () => {
    setup({ language: "ur", role: "MANAGER", search: "?locationId=19" });
    const trigger = screen.getByRole("button", { name: `${translate("Location", "ur")}: Today` });
    expect(trigger).toBeVisible();
    openLocation("ur");
    const menu = screen.getByRole("menu", { name: translate("Location", "ur") });
    expect(menu).toHaveAttribute("dir", "rtl");
    expect(within(menu).getByRole("menuitemradio", { name: "Today" })).toHaveAttribute("aria-checked", "true");
    expect(within(menu).getByRole("menuitemradio", { name: translate("My assigned locations", "ur") })).toBeVisible();
  });

  it("reflects URL navigation without mutating the dailyLink scope contract", async () => {
    const { router, params } = setup({ search: "?locationId=7&date=2026-11-09&tab=staff" });
    await act(() => router.navigate("/today-status?locationId=19&date=today&tab=tasks"));
    expect(screen.getByRole("button", { name: "Location: Today" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Date: Today" })).toBeVisible();
    expect(dailyLink(params(), { tab: "staff" })).toBe("/today-status?locationId=19&date=today&tab=staff");
    await act(() => router.navigate(-1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Location: North office" })).toBeVisible());
    expect(screen.getByRole("button", { name: "Date: 9 Nov 2026" })).toBeVisible();
  });
});
