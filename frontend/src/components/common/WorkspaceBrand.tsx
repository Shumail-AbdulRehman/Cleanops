/** A fresh leaf mark for the operations workspace; public-site branding is unchanged. */
export default function WorkspaceBrand() {
  return (
    <span className="workspace-product-logo">
      <svg
        width="36"
        height="40"
        viewBox="0 0 40 44"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M21 21C20 9 28 3 38 2C38 13 32 21 21 21Z"
          fill="currentColor"
        />
        <path
          d="M18 30C7 30 2 23 2 12C12 13 19 18 18 30Z"
          fill="currentColor"
          opacity=".72"
        />
        <path
          d="M20 42C18 31 19 23 30 12M20 35C17 27 13 23 8 20"
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinecap="round"
        />
      </svg>
      <span>
        Hygene <span>Ops</span>
      </span>
    </span>
  );
}
