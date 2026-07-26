import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useFirstSeen } from "./useFirstSeen";
import useAuth from "@/hooks/useAuth";
import { ONBOARDING_ROUTES } from "@/pages/Onboarding/onboardingRoutes";

export function WorkspaceLink({
  className = "marketing-button primary-button",
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const { isAuthenticated } = useAuth();
  return (
    <Link className={className} to={isAuthenticated ? ONBOARDING_ROUTES.continue : ONBOARDING_ROUTES.signup}>
      {children ?? (isAuthenticated ? "Open your workspace" : "Get started")}
      <ArrowRight size={17} />
    </Link>
  );
}

export function MarketingCTA() {
  const [tickRef, drawn] = useFirstSeen<SVGSVGElement>(0.25);
  return (
    <section className="hx-close" aria-labelledby="close-title">
      <svg ref={tickRef} className={drawn ? "hx-close-tick" : "hx-close-tick is-pre"} viewBox="0 0 100 100" aria-hidden="true">
        <path pathLength={1} d="M10 55 36 81 92 14" />
      </svg>
      <div className="marketing-container">
        <h2 id="close-title">
          Add <span>Building A</span>. Add its <span>washrooms</span>. List the{" "}
          <span>floors, basins and mirrors</span>. Set it for <span>8:00 every day</span>.
        </h2>
        <div className="hx-close-actions">
          <WorkspaceLink className="hx-btn hx-btn-white" />
          <p>Create your account first. Choose your plan next.</p>
        </div>
      </div>
    </section>
  );
}
