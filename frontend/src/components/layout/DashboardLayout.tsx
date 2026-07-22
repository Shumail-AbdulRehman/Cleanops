import PageLoadingSkeleton from "@/components/common/PageLoadingSkeleton";
import LanguageChoice from "@/components/common/LanguageChoice";
import { WorkspaceTheme } from "@/components/common/WorkspaceTheme";
import { useLanguage } from "@/i18n/context";
import { Suspense, useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Menu, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Sidebar from "./Sidebar";
import { useSubscription } from "@/pages/Subscription/queries";
import WorkspaceGate from "@/components/onboarding/WorkspaceGate";
import "@/workspace.css";
import "@/workspace-refresh.css";
import "@/workspace-tokens.css";
import "./shell-v6.css";

const TITLES: Record<string, string> = {
  dashboard: "Overview",
  setup: "Setup",
  "today-status": "Today",
  locations: "Locations",
  staff: "Team",
  attendance: "Attendance",
  managers: "Managers",
  subscription: "Plan & billing",
  exceptions: "Photo Reviews",
  verification: "Task photos",
  areas: "Room",
  settings: "Settings",
  account: "Settings",
};
export default function DashboardLayout() {
  const { t, language } = useLanguage();
  const subscription = useSubscription();
  const companyName = subscription.data?.company?.name;
  const [localDate, setLocalDate] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setLocalDate(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { pathname } = useLocation();
  const [section, detail] = pathname.split("/").filter(Boolean);
  useEffect(() => {
    document.title = t(TITLES[section] || "Workspace") + " · Hygene Ops";
    window.scrollTo(0, 0);
  }, [pathname, section, t]);
  return (
    <WorkspaceTheme.Provider value={true}>
      <div className="workspace wx-shell min-h-screen">
        <a href="#workspace-content" className="workspace-skip">
          {t("Skip to content")}
        </a>
        <Sidebar companyName={companyName} planName={subscription.data?.plan?.name}
          companyLoading={subscription.isPending} companyError={subscription.isError}
          companyRefreshing={subscription.isFetching} onRetryCompany={() => { void subscription.refetch(); }}
          open={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
        <div className="wx-shell-main">
          <header className="wx-shell-topbar">
            <div className="wx-shell-leading">
              <Button
                variant="ghost"
                size="icon"
                className="workspace-menu-trigger wx-shell-menu-trigger"
                id="workspace-menu-trigger"
                aria-label={t("Open navigation")}
                aria-expanded={isSidebarOpen}
                aria-controls="workspace-mobile-menu"
                aria-haspopup="dialog"
                onClick={() => setIsSidebarOpen(true)}
              >
                <Menu size={20} aria-hidden="true" />
              </Button>
              <nav
                aria-label={t("Breadcrumb")}
                className="wx-shell-breadcrumb"
              >
                <Link
                  aria-current={detail ? undefined : "page"}
                  to={
                    section === "areas"
                      ? "/locations"
                      : section === "verification"
                        ? "/today-status?tab=tasks"
                        : section === "account"
                          ? "/account/security"
                          : "/" + section
                  }
                >
                  {t(
                    section === "areas"
                      ? "Locations"
                      : TITLES[section] || "Workspace",
                  )}
                </Link>
                {detail && (
                  <>
                    <ChevronRight className="wx-shell-directional" size={14} aria-hidden="true" />
                    <span aria-current="page">{t(section === "areas" ? "Room" : "Details")}</span>
                  </>
                )}
              </nav>
            </div>
            <div className="wx-shell-tools">
              <time className="wx-shell-date" dateTime={`${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, "0")}-${String(localDate.getDate()).padStart(2, "0")}`}>
                {localDate.toLocaleDateString(language === "ur" ? "ur-PK" : "en-PK", { weekday: "long", day: "numeric", month: "long" })}
              </time>
              <LanguageChoice />
            </div>
          </header>
          <main
            id="workspace-content"
            tabIndex={-1}
            className="workspace-content wx-shell-content"
          >
            <Suspense fallback={<PageLoadingSkeleton />}>
              <WorkspaceGate><Outlet /></WorkspaceGate>
            </Suspense>
          </main>
        </div>
      </div>
    </WorkspaceTheme.Provider>
  );
}
