import type { ReactNode } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import authReducer, { setUser, type AuthUser } from "@/store/slices/authSlice";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import { translate } from "@/i18n/translations";
import DashboardLayout from "./DashboardLayout";

const m = vi.hoisted(() => ({
  get: vi.fn(),
  logout: { mutate: vi.fn(), isPending: false, isError: false },
}));
vi.mock("@/api/client", () => ({ client: { get: m.get } }));
vi.mock("@/queries/auth", () => ({ useLogout: () => m.logout }));
// Gate authorization is covered by the existing actual-route integration tests.
vi.mock("@/components/onboarding/WorkspaceGate", () => ({ default: ({ children }: { children: ReactNode }) => children }));

const summary = (companyId = 42, name = "Saved company", plan = "Pro") => ({
  company: { id: companyId, name, plan: "PRO" }, plan: { name: plan },
});
function mount({ role = "ADMIN", path = "/dashboard", language = "en" }: {
  role?: AuthUser["role"]; path?: string; language?: "en" | "ur";
} = {}) {
  localStorage.setItem("hygene-ops.language", language);
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ id: 7, role, name: "Saved account", email: "fixture@example.invalid", companyId: 42 }));
  const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const router = createMemoryRouter([{ path: "/", element: <DashboardLayout />, children: [
    { path: "*", element: <h1>Screen content</h1> },
  ] }], { initialEntries: [path] });
  render(<Provider store={store}><QueryClientProvider client={query}><LanguageProvider><RouterProvider router={router} /></LanguageProvider></QueryClientProvider></Provider>);
  return { query, router, store };
}
const nav = () => screen.getByRole("navigation", { name: "Workspace navigation" });
const link = (name: string) => within(nav()).getByRole("link", { name });
const ready = () => screen.findByText("Saved company");
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  document.documentElement.dir = "ltr";
  document.documentElement.lang = "en-PK";
  m.logout.isPending = false; m.logout.isError = false;
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  m.get.mockImplementation(async (url: string) => ({ data: { data: url === "/subscription" ? summary() : { total: 4 } } }));
});

describe("workspace app shell", () => {
  it.each([
    ["/verification/1", "Today"], ["/verification/1/photos", "Today"],
    ["/areas/9", "Locations"], ["/locations/3", "Locations"],
    ["/staff/7", "Team"], ["/attendance?date=2026-11-10", "Attendance"],
    ["/exceptions/3", "Photo Reviews"], ["/setup", "Company setup"],
  ])("marks only the matching navigation page at %s", async (path, name) => {
    mount({ path }); await ready();
    const current = within(nav()).getAllByRole("link").filter(item => item.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(name);
  });

  it.each(["ADMIN", "MANAGER"] as const)("groups every operational and organization link for %s", async role => {
    mount({ role }); await ready();
    const daily = within(nav()).getByRole("group", { name: "Daily operations" });
    expect(within(daily).getAllByRole("link").map(item => item.getAttribute("href")))
      .toEqual(["/dashboard", "/today-status", "/exceptions", "/attendance"]);
    const organization = within(nav()).getByRole("group", { name: "Your organization" });
    expect(within(organization).getAllByRole("link").map(item => item.getAttribute("href")))
      .toEqual(role === "ADMIN" ? ["/locations", "/staff", "/managers", "/setup"] : ["/locations", "/staff"]);
    const administration = within(nav()).getByRole("group", { name: "Administration" });
    expect(within(administration).getAllByRole("link").map(item => item.getAttribute("href")))
      .toEqual(role === "ADMIN" ? ["/settings", "/subscription"] : ["/account/security"]);
  });

  it("hides owner-only items and marks manager account security as Settings", async () => {
    mount({ role: "MANAGER", path: "/account/security" }); await ready();
    for (const name of ["Managers", "Company setup", "Plan & billing"])
      expect(within(nav()).queryByRole("link", { name })).not.toBeInTheDocument();
    expect(link("Settings")).toHaveAttribute("href", "/account/security");
    expect(link("Settings")).toHaveAttribute("aria-current", "page");
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/account/security");
  });

  it.each(["ADMIN", "MANAGER"] as const)("reads and shows the real company and plan for %s without repeated fallbacks or account names", async role => {
    mount({ role }); await ready();
    expect(screen.getAllByText("Saved company")).toHaveLength(1);
    expect(screen.getAllByText("Saved account")).toHaveLength(1);
    expect(screen.getByText("Pro plan")).toBeVisible();
    expect(screen.queryByText("Company workspace")).not.toBeInTheDocument();
    expect(m.get.mock.calls.filter(([url]) => url === "/subscription")).toHaveLength(1);
    expect(m.get.mock.calls.every(([url]) => ["/subscription", "/verification-exceptions/count"].includes(url))).toBe(true);
  });

  it("shows an announced skeleton during initial company loading, then the saved name", async () => {
    const response = deferred<{ data: { data: ReturnType<typeof summary> } }>();
    m.get.mockImplementation((url: string) => url === "/subscription" ? response.promise : Promise.resolve({ data: { data: { total: 0 } } }));
    mount();
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(screen.queryByText("Company workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Pro plan")).not.toBeInTheDocument();
    await act(async () => response.resolve({ data: { data: summary() } }));
    await ready();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows one fallback and working Retry after a failed company read", async () => {
    let failed = true;
    m.get.mockImplementation(async (url: string) => {
      if (url === "/subscription" && failed) throw Error("Read failed");
      return { data: { data: url === "/subscription" ? summary() : { total: 0 } } };
    });
    mount({ role: "MANAGER" });
    expect(await screen.findByText("Company details could not load.")).toBeVisible();
    expect(screen.getAllByText("Company workspace")).toHaveLength(1);
    expect(screen.getByText("Check your connection and try again. Your saved records have not changed.")).toBeVisible();
    failed = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await ready();
    expect(screen.queryByText("Company workspace")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("keeps the company name, content and focused control on background read failure", async () => {
    const { query } = mount(); await ready();
    const signout = screen.getByRole("button", { name: "Sign out" }); signout.focus();
    m.get.mockRejectedValue(Error("Offline"));
    await act(async () => { await query.refetchQueries({ queryKey: ["subscription", 42, 7] }); });
    expect(screen.getByText("Saved company")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Screen content" })).toBeVisible();
    expect(signout).toHaveFocus();
    expect(screen.queryByText("Company workspace")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("does not show another company's cached or returned name after an identity change", async () => {
    const { store } = mount({ role: "MANAGER" }); await ready();
    const response = deferred<{ data: { data: ReturnType<typeof summary> } }>();
    m.get.mockImplementation((url: string) => url === "/subscription" ? response.promise : Promise.resolve({ data: { data: { total: 0 } } }));
    act(() => store.dispatch(setUser({ id: 8, companyId: 99, role: "MANAGER", name: "Second account", email: "second@example.invalid" })));
    expect(screen.queryByText("Saved company")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    await act(async () => response.resolve({ data: { data: summary(42, "Foreign company") } }));
    await screen.findByRole("button", { name: "Retry" });
    expect(screen.queryByText("Foreign company")).not.toBeInTheDocument();
  });

  it.each([[0, null], [4, "4"], [140, "99+"]] as const)("shows the real review badge only for a positive count (%s)", async (total, text) => {
    m.get.mockImplementation(async (url: string) => ({ data: { data: url === "/subscription" ? summary() : { total } } }));
    mount(); await ready();
    const review = within(nav()).getByRole("link", { name: /Photo Reviews/ });
    if (text) expect(within(review).getByLabelText(`${total} Waiting for review`)).toHaveTextContent(text);
    else expect(review).toHaveAccessibleName("Photo Reviews");
  });

  it("never invents a review count when the count request fails", async () => {
    m.get.mockImplementation(async (url: string) => {
      if (url !== "/subscription") throw Error("Count unavailable");
      return { data: { data: summary() } };
    });
    mount(); await ready();
    expect(link("Photo Reviews")).toHaveAccessibleName("Photo Reviews");
  });

  it.each([
    ["/verification/1", "/today-status?tab=tasks", "Task photos", "Details"],
    ["/areas/2", "/locations", "Locations", "Room"],
    ["/locations/2", "/locations", "Locations", "Details"],
  ])("preserves the detail breadcrumb at %s", async (path, href, title, detail) => {
    mount({ path }); await ready();
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByRole("link", { name: title })).toHaveAttribute("href", href);
    expect(within(breadcrumb).getByText(detail)).toHaveAttribute("aria-current", "page");
  });

  it("keeps skip navigation, the main landmark and current-page title", async () => {
    mount(); await ready();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#workspace-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "workspace-content");
    expect(document.title).toBe("Overview · Hygene Ops");
    expect(link("Overview")).toHaveAttribute("aria-current", "page");
  });

  it("shows the current local date and translates the shell when language changes", async () => {
    mount(); await ready();
    expect(screen.getByText(new Date().toLocaleDateString("en-PK", { weekday: "long", day: "numeric", month: "long" }))).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "اردو" }));
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("ur-PK");
    expect(screen.getByRole("navigation", { name: translate("Workspace navigation", "ur") })).toBeVisible();
    expect(screen.getByText(translate("{plan} plan", "ur", { plan: translate("Pro", "ur") }))).toBeVisible();
    expect(screen.getByText("Saved company")).toBeVisible();
    expect(screen.getByText("Saved account")).toBeVisible();
  });

  it("invokes sign out and prevents duplicate requests while pending", async () => {
    const { router } = mount(); await ready();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(m.logout.mutate).toHaveBeenCalledTimes(1);
    m.logout.isPending = true;
    await act(async () => { await router.navigate("/staff"); });
    const pending = screen.getByRole("button", { name: "Signing out…" });
    expect(pending).toBeDisabled(); fireEvent.click(pending);
    expect(m.logout.mutate).toHaveBeenCalledTimes(1);
  });

  it("announces sign-out failure and leaves the action available", async () => {
    m.logout.isError = true; mount(); await ready();
    expect(screen.getByRole("alert")).toHaveTextContent("Sign out failed. Try again.");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
  });

  it("opens a named drawer, traps focus, dismisses on Escape and restores the menu trigger", async () => {
    mount(); await ready();
    const trigger = screen.getByRole("button", { name: "Open navigation" });
    trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Workspace menu" });
    expect(dialog).toHaveAccessibleDescription("Navigate your Hygene Ops workspace.");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByRole("button", { name: "Sign out" })).toBeVisible();
    // Radix captures focus attempts that leave the modal.
    screen.getByRole("main", { hidden: true }).focus();
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it.each(["ADMIN", "MANAGER"] as const)("retains role-specific links and closes after drawer navigation for %s", async role => {
    const { router } = mount({ role }); await ready();
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("link", { name: "Plan & billing" }) !== null).toBe(role === "ADMIN");
    fireEvent.click(within(dialog).getByRole("link", { name: "Team" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe("/staff");
  });

  it("offers translated drawer navigation, close and sign out in Urdu", async () => {
    mount({ language: "ur", role: "MANAGER" }); await ready();
    const trigger = screen.getByRole("button", { name: translate("Open navigation", "ur") });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: translate("Workspace menu", "ur") });
    expect(dialog.closest("[dir]")).toHaveAttribute("dir", "rtl");
    expect(within(dialog).getByRole("button", { name: translate("Sign out", "ur") })).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: translate("Close navigation", "ur") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
