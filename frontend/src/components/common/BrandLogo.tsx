import './brand.css';

/** Shared identity. The adjacent wordmark supplies the accessible name. */
export function BrandMark() {
  return <img className="hygene-mark" src="/brand/hygene-ops-mark.svg" width={36} height={36} alt="" aria-hidden="true" />;
}

export default function BrandLogo() {
  return <span className="hygene-logo"><BrandMark /><span className="hygene-wordmark">Hygene <span>Ops</span></span></span>;
}
