import { useState, type ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Provider } from "react-redux";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/common/PageHeader";
import EmptyState from "@/components/common/EmptyState";
import LoadingSkeleton, { type SkeletonVariant } from "@/components/common/LoadingSkeleton";
import PageLoadingSkeleton from "@/components/common/PageLoadingSkeleton";
import type { PageLoadingLayout } from "@/components/common/loadingLayout";
import OperationsState from "@/pages/Manager/OperationsState";
import { LanguageContext } from "@/i18n/context";
import { translate, type Language } from "@/i18n/translations";
import { store } from "@/store/store";

function Providers({ children, language = "en", route = "/dashboard" }: { children: ReactNode; language?: Language; route?: string }) {
  return <Provider store={store}><MemoryRouter initialEntries={[route]}>
    <LanguageContext.Provider value={{ language, setLanguage: () => {}, t: (text, values) => translate(text, language, values) }}>
      <div className="workspace" dir={language === "ur" ? "rtl" : "ltr"} lang={language === "ur" ? "ur-PK" : "en-PK"}>{children}</div>
    </LanguageContext.Provider>
  </MemoryRouter></Provider>;
}

const reassurance = "Check your connection and try again. Your saved records have not changed.";
const stale = "You are viewing the last loaded information. Reconnect and refresh before making changes.";
const denied = "You do not have access to this location. Choose an assigned location or ask your owner.";
const layouts: PageLoadingLayout[] = ["owner-overview", "manager-overview", "today", "today-summary", "today-table", "locations", "location-detail", "team", "team-detail", "attendance", "managers", "billing", "reviews", "review-detail", "verification", "area", "area-setup", "schedule", "area-table", "staff-preview", "task-summary", "trends", "records"];

function expectLoading() {
  const status = screen.getByRole("status", { name: "Loading…" });
  expect(status).toHaveAttribute("aria-busy", "true");
  expect(status).toHaveAttribute("aria-live", "polite");
  expect(within(status).getByText("Loading…")).toBeInTheDocument();
  expect(within(status).queryByRole("button")).not.toBeInTheDocument();
  expect(within(status).queryByRole("img")).not.toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  return status;
}

describe("PageHeader", () => {
  it("keeps title, subtitle, action and caller className while rendering additional tools", () => {
    const action = vi.fn();
    render(<Providers><PageHeader title="Locations" subtitle="Find a location" className="caller-header" tools={<label>Scope<select aria-label="Scope"><option>All locations</option></select></label>} action={<button onClick={action}>Add location</button>} /></Providers>);
    expect(screen.getByRole("heading", { level: 1, name: "Locations" }).parentElement?.parentElement).toHaveClass("caller-header");
    expect(screen.getByText("Find a location")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Scope" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Add location" }));
    expect(action).toHaveBeenCalledOnce();
  });
  it("supports tools without an action and a title without optional content", () => {
    const { rerender } = render(<Providers><PageHeader title="Team" tools={<button>Refresh</button>} /></Providers>);
    expect(screen.getByRole("button", { name: "Refresh" })).toBeVisible();
    rerender(<Providers><PageHeader title="Team" /></Providers>);
    expect(screen.getByRole("heading", { name: "Team" })).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("translates interface headings and subtitles under Urdu", () => {
    render(<Providers language="ur"><PageHeader title="Locations" subtitle="Find a location" /></Providers>);
    expect(screen.getByRole("heading", { name: translate("Locations", "ur") })).toBeVisible();
    expect(screen.getByText(translate("Find a location", "ur"))).toBeVisible();
  });
});

describe("EmptyState", () => {
  it("shows a default title and decorative icon without adding an action", () => {
    render(<Providers><EmptyState /></Providers>);
    expect(screen.getByRole("heading", { level: 2, name: "Nothing here yet." })).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("keeps existing message/icon props and accepts a new title and working button action", () => {
    const action = vi.fn();
    render(<Providers><EmptyState title="Nothing is waiting for you" message="See reviewed" icon={<svg role="img" aria-label="Decorative" />} action={<button onClick={action}>See reviewed</button>} /></Providers>);
    expect(screen.getByRole("heading", { name: "Nothing is waiting for you" })).toBeVisible();
    expect(screen.getByText("See reviewed", { selector: "p" })).toBeVisible();
    expect(screen.queryByRole("img", { name: "Decorative" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See reviewed" }));
    expect(action).toHaveBeenCalledOnce();
  });
  it("keeps a link action's real destination and router navigation", () => {
    function Destination() { return <output aria-label="Current route">{useLocation().pathname}</output>; }
    render(<Providers><EmptyState message="Add your first location" action={<Link to="/locations">Add location</Link>} /><Destination /></Providers>);
    expect(screen.getByRole("link", { name: "Add location" })).toHaveAttribute("href", "/locations");
    fireEvent.click(screen.getByRole("link", { name: "Add location" }));
    expect(screen.getByLabelText("Current route")).toHaveTextContent("/locations");
  });
  it("preserves the disabled state supplied by a caller", () => {
    const action = vi.fn();
    render(<Providers><EmptyState action={<button disabled onClick={action}>Add location</button>} /></Providers>);
    fireEvent.click(screen.getByRole("button", { name: "Add location" }));
    expect(screen.getByRole("button")).toBeDisabled();
    expect(action).not.toHaveBeenCalled();
  });
  it("translates its title and legacy explanation in Urdu", () => {
    render(<Providers language="ur"><EmptyState title="Locations" message="Add your first location" /></Providers>);
    expect(screen.getByRole("heading", { name: translate("Locations", "ur") })).toBeVisible();
    expect(screen.getByText(translate("Add your first location", "ur"))).toBeVisible();
  });
});

describe("loading layouts", () => {
  it.each<SkeletonVariant>(["overview", "table", "detail", "metrics", "panel"])("announces one loading status for the %s variant and hides placeholders", variant => {
    render(<Providers><LoadingSkeleton variant={variant} header /></Providers>);
    expectLoading();
  });
  it.each(layouts)("keeps the %s layout available through OperationsState", layout => {
    render(<Providers><OperationsState loading layout={layout} /></Providers>);
    expect(expectLoading()).toHaveAttribute("data-loading-layout", layout);
  });
  it.each(["team-detail", "location-detail", "area"] as const)("keeps the URL's selected tab for %s", layout => {
    render(<Providers route="/locations/1?tab=attendance"><PageLoadingSkeleton layout={layout} /></Providers>);
    const expected = layout === "team-detail" ? "attendance" : layout === "location-detail" ? "overview" : "inventory";
    expect(expectLoading()).toHaveAttribute("data-loading-tab", expected);
  });
  it("resolves the existing route layout when one is not explicitly passed", () => {
    render(<Providers route="/locations/1?tab=staff"><PageLoadingSkeleton /></Providers>);
    expect(expectLoading()).toHaveAttribute("data-loading-layout", "location-detail");
    expect(screen.getByRole("status")).toHaveAttribute("data-loading-tab", "staff");
  });
  it("translates the loading announcement once and hides decorative headings in Urdu", () => {
    render(<Providers language="ur"><PageLoadingSkeleton layout="today" /></Providers>);
    const status = screen.getByRole("status", { name: translate("Loading…", "ur") });
    expect(within(status).getByText(translate("Loading…", "ur"))).toBeInTheDocument();
    expect(within(status).queryByRole("heading")).not.toBeInTheDocument();
  });
});

describe("OperationsState", () => {
  it("renders nothing when loaded and online", () => {
    render(<Providers><OperationsState /></Providers>);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("shows an alert with reassurance and a working non-submit Retry, then loading and recovery", () => {
    function Recovery() {
      const [state, setState] = useState("error");
      return <form onSubmit={event => { event.preventDefault(); throw Error("Retry must not submit"); }}>
        <OperationsState error={state === "error" ? Error("Internal details") : undefined} loading={state === "loading"} retry={() => setState("loading")} />
        {state === "loading" && <button type="button" onClick={() => setState("ready")}>Finish request</button>}
        {state === "ready" && <p>Saved location</p>}
      </form>;
    }
    render(<Providers><Recovery /></Providers>);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("heading", { name: "This page could not load" })).toBeVisible();
    expect(within(alert).getByText(reassurance)).toBeVisible();
    expect(screen.queryByText("Internal details")).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expectLoading();
    fireEvent.click(screen.getByRole("button", { name: "Finish request" }));
    expect(screen.getByText("Saved location")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("preserves permission-specific guidance without exposing server details", () => {
    render(<Providers><OperationsState error={{ response: { status: 403 }, message: "secret" }} retry={() => {}} /></Providers>);
    expect(within(screen.getByRole("alert")).getByText(denied)).toBeVisible();
    expect(screen.getByText(reassurance)).toBeVisible();
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });
  it("does not render an inert retry button when no callback is available", () => {
    render(<Providers><OperationsState error={Error("Failed")} /></Providers>);
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
  it("keeps error priority when both loading and error are supplied", () => {
    render(<Providers><OperationsState loading error={Error("Failed")} retry={() => {}} /></Providers>);
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("keeps the last-loaded notice offline and removes it after reconnection", () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<Providers><OperationsState /></Providers>);
    expect(screen.getByRole("status")).toHaveTextContent(stale);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    online.mockReturnValue(true);
    fireEvent(window, new Event("online"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("uses a skeleton for the initial offline request instead of implying cached data exists", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<Providers><OperationsState loading /></Providers>);
    expectLoading();
    expect(screen.queryByText(stale)).not.toBeInTheDocument();
  });
  it("translates the error, permission guidance, reassurance and Retry in Urdu", () => {
    render(<Providers language="ur"><OperationsState error={{ response: { status: 403 } }} retry={() => {}} /></Providers>);
    expect(screen.getByRole("heading", { name: translate("This page could not load", "ur") })).toBeVisible();
    expect(screen.getByText(translate(denied, "ur"))).toBeVisible();
    expect(screen.getByText(translate(reassurance, "ur"))).toBeVisible();
    expect(screen.getByRole("button", { name: translate("Retry", "ur") })).toBeVisible();
  });
  it("preserves the translated stale-data notice in Urdu", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<Providers language="ur"><OperationsState /></Providers>);
    expect(screen.getByRole("status")).toHaveTextContent(translate(stale, "ur"));
  });
  it("keeps cached records and focus during a real Query background refetch", async () => {
    let complete!: (data: string) => void;
    const load = vi.fn(() => new Promise<string>(resolve => { complete = resolve; }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["page-state-records"], "Saved location");
    function Records() {
      const query = useQuery({ queryKey: ["page-state-records"], queryFn: load, staleTime: Infinity });
      return <><OperationsState loading={query.isPending} error={query.error} retry={() => void query.refetch()} layout="locations" />
        <button onClick={() => void query.refetch()}>Refresh records</button><p>{query.data}</p></>;
    }
    render(<Providers><QueryClientProvider client={queryClient}><Records /></QueryClientProvider></Providers>);
    const refresh = screen.getByRole("button", { name: "Refresh records" });
    refresh.focus();
    fireEvent.click(refresh);
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    expect(screen.getByText("Saved location")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(refresh).toHaveFocus();
    await act(async () => complete("Updated location"));
    await waitFor(() => expect(screen.getByText("Updated location")).toBeVisible());
    expect(refresh).toHaveFocus();
    queryClient.clear();
  });
});
