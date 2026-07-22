import { Link, useLocation } from "react-router-dom";
import { Menu, X, ArrowUpRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import useAuth from "@/hooks/useAuth";
import BrandLogo from "@/components/common/BrandLogo";
import "@/marketing.css";
import "@/marketing-redesign.css";

const links = [
  { label: "Home", href: "/" },
  { label: "Features", href: "/features" },
  { label: "Pricing", href: "/pricing" },
];

export function PublicNavbar({ languageChoice }: { languageChoice?: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const { pathname } = useLocation();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;
  return (
    <header className="marketing-nav">
      <div className="marketing-container nav-inner">
        <Link to="/" className="marketing-brand" aria-label="Hygene Ops home">
          <BrandLogo />
        </Link>
        <nav className="desktop-nav" aria-label="Main navigation">
          {links.map((link) => (
            <Link
              key={link.href}
              to={link.href}
              aria-current={pathname === link.href ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="nav-end">
          {languageChoice}
          <div className="desktop-nav nav-actions">
            {!isAuthenticated && (
              <Link
                to="/login"
                className="login-link"
                aria-current={pathname === "/login" ? "page" : undefined}
              >
                Log in
              </Link>
            )}
            <Link
              to={isAuthenticated ? "/dashboard" : "/signup"}
              className="marketing-button primary-button"
            >
              {isAuthenticated ? "Open dashboard" : "Get started"}
              <ArrowUpRight size={16} />
            </Link>
          </div>
        </div>
        <button
          className="mobile-nav-toggle"
          type="button"
          aria-expanded={open}
          aria-controls="mobile-navigation"
          aria-label={open ? "Close navigation" : "Open navigation"}
          onClick={() => setOpenPath(open ? null : pathname)}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
      {open && (
        <nav
          id="mobile-navigation"
          className="mobile-navigation"
          aria-label="Mobile navigation"
        >
          {links.map((link) => (
            <Link
              key={link.href}
              to={link.href}
              onClick={() => setOpenPath(null)}
              aria-current={pathname === link.href ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
          {!isAuthenticated && (
            <Link to="/login" onClick={() => setOpenPath(null)}>
              Log in
            </Link>
          )}
          <Link
            to={isAuthenticated ? "/dashboard" : "/signup"}
            onClick={() => setOpenPath(null)}
            className="marketing-button primary-button"
          >
            {isAuthenticated ? "Open dashboard" : "Get started"}
            <ArrowUpRight size={16} />
          </Link>
        </nav>
      )}
    </header>
  );
}
