import { Link, Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { PublicNavbar } from "./PublicNavbar";
import { SocialLinks } from "./SocialLinks";
import BrandLogo from "@/components/common/BrandLogo";

export function PublicLayout() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      requestAnimationFrame(() =>
        document.getElementById(hash.slice(1))?.scrollIntoView(),
      );
    } else window.scrollTo({ top: 0, behavior: "instant" });
    const titles: Record<string, string> = {
      "/": "Hygene Ops | A clearer day for your cleaning business",
      "/features": "Features | Hygene Ops",
      "/pricing": "Simple plans for cleaning teams | Hygene Ops",
    };
    document.title = titles[pathname] ?? "Hygene Ops";
  }, [pathname, hash]);
  return (
    <div className="marketing-site">
      <a href="#main-content" className="marketing-skip">
        Skip to content
      </a>
      <PublicNavbar />
      <main id="main-content">
        <Outlet />
      </main>
      <footer className="hx-footer">
        <div className="marketing-container">
          <div className="hx-footer-top">
            <Link to="/" className="marketing-brand" aria-label="Hygene Ops home">
              <BrandLogo />
            </Link>
            <nav aria-label="Footer">
              <Link to="/features">Features</Link>
              <Link to="/pricing">Pricing</Link>
              <Link to="/#watch">Watch the video</Link>
              <Link to="/login">Log in</Link>
              <Link to="/signup">Create an account</Link>
            </nav>
            <SocialLinks />
          </div>
          <p className="hx-footer-fine">
            © {new Date().getFullYear()} Hygene Ops. Made for cleaning companies
            in Pakistan.
          </p>
        </div>
      </footer>
    </div>
  );
}
