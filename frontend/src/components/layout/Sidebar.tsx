import BrandLogo from "@/components/common/BrandLogo";
import PersonAvatar from "@/components/workspace/PersonAvatar";
import { useLanguage } from "@/i18n/context";
import { Link, matchPath, useLocation } from "react-router-dom";
import { useExceptionCount } from "@/pages/Exceptions/queries";
import {
  ListChecks, LayoutDashboard, MapPin, Users, UserCog, Settings,
  Sun, UserCheck, LogOut, ClipboardCheck, CreditCard, Building2, X,
} from "lucide-react";
import { Dialog } from "radix-ui";
import { useLogout } from "@/queries/auth";
import { useSelector } from "react-redux";
import type { RootState } from "@/store/store";
import { cn } from "@/lib/utils";
import "./shell-v6.css";

const DAILY = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Overview" },
  { to: "/today-status", icon: Sun, label: "Today" },
  { to: "/exceptions", icon: ClipboardCheck, label: "Photo Reviews" },
  { to: "/attendance", icon: UserCheck, label: "Attendance" },
];
const ORGANIZATION = [
  { to: "/locations", icon: MapPin, label: "Locations" },
  { to: "/staff", icon: Users, label: "Team" },
];

function isCurrent(to: string, pathname: string) {
  return Boolean(matchPath({ path: to, end: false }, pathname)) ||
    (to === "/today-status" && Boolean(matchPath("/verification/*", pathname))) ||
    (to === "/locations" && Boolean(matchPath("/areas/*", pathname)));
}

type SidebarProps = {
  companyName?: string;
  planName?: string;
  companyLoading?: boolean;
  companyError?: boolean;
  companyRefreshing?: boolean;
  onRetryCompany?: () => void;
  open?: boolean;
  onClose?: () => void;
};

export default function Sidebar({
  open = false, onClose, companyName, planName, companyLoading = false,
  companyError = false, companyRefreshing = false, onRetryCompany,
}: SidebarProps) {
  const { t, language } = useLanguage();
  const { pathname } = useLocation();
  const user = useSelector((s: RootState) => s.auth.user);
  const logout = useLogout();
  const exceptions = useExceptionCount(user?.role === "ADMIN" || user?.role === "MANAGER");
  const owner = user?.role === "ADMIN";
  const name = companyName?.trim();
  const groups = [
    { label: "Daily operations", items: DAILY },
    { label: "Your organization", items: [
      ...ORGANIZATION,
      ...(owner ? [
        { to: "/managers", icon: UserCog, label: "Managers" },
        { to: "/setup", icon: ListChecks, label: "Company setup" },
      ] : []),
    ] },
    { label: "Administration", items: [
      { to: owner ? "/settings" : "/account/security", icon: Settings, label: "Settings" },
      ...(owner ? [{ to: "/subscription", icon: CreditCard, label: "Plan & billing" }] : []),
    ] },
  ];
  const count = exceptions.data?.total ?? 0;
  const content = <>
    <Link to="/dashboard" onClick={onClose} className="wx-shell-brand"><BrandLogo /></Link>
    <div className="wx-shell-company" aria-busy={companyLoading}>
      <span className="wx-shell-monogram" aria-hidden="true">
        {name ? name.split(/\s+/).map(word => word[0]).join("").slice(0, 2).toUpperCase() : <Building2 size={18} />}
      </span>
      <div className="wx-shell-company-copy">
        {companyLoading ? <>
          <span role="status" className="sr-only">{t("Loading…")}</span>
          <span className="wx-shell-skeleton" aria-hidden="true" />
          <span className="wx-shell-skeleton wx-shell-skeleton-short" aria-hidden="true" />
        </> : <>
          <strong><bdi>{name || t("Company workspace")}</bdi></strong>
          <small>{planName ? t("{plan} plan", { plan: t(planName) }) : t(owner ? "Company owner" : "Location manager")}</small>
        </>}
        {companyError && !companyLoading && <div className="wx-shell-company-error">
          <span role="status">{t("Company details could not load.")}</span>
          <small>{t("Check your connection and try again. Your saved records have not changed.")}</small>
          {onRetryCompany && <button type="button" onClick={onRetryCompany} disabled={companyRefreshing}>{t(companyRefreshing ? "Loading…" : "Retry")}</button>}
        </div>}
      </div>
    </div>
    <nav aria-label={t("Workspace navigation")} className="wx-shell-navigation">
      {groups.map(group => <div className="wx-shell-group" key={group.label} role="group" aria-label={t(group.label)}>
        <div className="wx-shell-group-title" aria-hidden="true">{t(group.label)}</div>
        {group.items.map(({ to, icon: Icon, label }) => <Link
          key={to} to={to} onClick={onClose}
          aria-current={isCurrent(to, pathname) ? "page" : undefined}
          className={cn("wx-shell-link", isCurrent(to, pathname) && "wx-shell-link-current")}
        >
          <Icon aria-hidden="true" strokeWidth={1.75} />
          <span>{t(label)}</span>
          {to === "/exceptions" && count > 0 && <span className="wx-shell-review-count" aria-label={`${count} ${t("Waiting for review")}`}>
            {count > 99 ? "99+" : count.toLocaleString(language === "ur" ? "ur-PK" : "en-PK")}
          </span>}
        </Link>)}
      </div>)}
    </nav>
    <footer className="wx-shell-account">
      <div className="wx-shell-account-row">
        <PersonAvatar name={user?.name} />
        <div className="wx-shell-account-copy">
          <strong><bdi>{user?.name}</bdi></strong>
          <small>{t(owner ? "Company owner" : "Location manager")}</small>
        </div>
        <button type="button" className="wx-shell-icon-button" disabled={logout.isPending}
          aria-label={t(logout.isPending ? "Signing out…" : "Sign out")}
          title={t(logout.isPending ? "Signing out…" : "Sign out")}
          onClick={() => logout.mutate()}>
          <LogOut aria-hidden="true" />
        </button>
      </div>
      {logout.isError && <p role="alert" className="wx-shell-signout-error">{t("Sign out failed. Try again.")}</p>}
    </footer>
  </>;

  return <>
    <aside className="wx-shell-rail wx-shell-desktop">{content}</aside>
    <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose?.(); }}>
      <Dialog.Portal>
        <div className="workspace wx-shell-portal" dir={language === "ur" ? "rtl" : "ltr"} lang={language === "ur" ? "ur-PK" : "en-PK"}>
          <Dialog.Overlay className="wx-shell-scrim" />
          <Dialog.Content id="workspace-mobile-menu" className="wx-shell-rail wx-shell-drawer"
            onCloseAutoFocus={event => {
              event.preventDefault();
              document.getElementById("workspace-menu-trigger")?.focus();
            }}>
            <Dialog.Title className="sr-only">{t("Workspace menu")}</Dialog.Title>
            <Dialog.Description className="sr-only">{t("Navigate your Hygene Ops workspace.")}</Dialog.Description>
            <Dialog.Close asChild><button type="button" className="wx-shell-icon-button wx-shell-close" aria-label={t("Close navigation")}><X aria-hidden="true" /></button></Dialog.Close>
            {content}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}
