import { useSyncExternalStore } from "react";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
const subscribeToMotion = (notify: () => void) => {
  const media = window.matchMedia(reducedMotionQuery);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};

export function GeofenceDiagram() {
  const prefersReducedMotion = useSyncExternalStore(
    subscribeToMotion,
    () => window.matchMedia(reducedMotionQuery).matches,
    () => true,
  );

  return (
    <figure
      className="relative w-full"
      style={{ aspectRatio: "16/10" }}
      aria-label="Geofence verification diagram"
    >
      <svg
        viewBox="0 0 320 200"
        className="h-full w-full"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
      >
        <defs>
          <style>
            {`
              @keyframes geofence-rotate {
                from { stroke-dashoffset: 0; }
                to { stroke-dashoffset: -40; }
              }
              .geofence-circle {
                animation: geofence-rotate 20s linear infinite;
              }
              @media (prefers-reduced-motion: reduce) {
                .geofence-circle {
                  animation: none;
                }
              }
            `}
          </style>
        </defs>

        {/* Subtle schematic grid dots */}
        {[
          [40, 60],
          [80, 60],
          [160, 60],
          [40, 100],
          [160, 100],
          [40, 140],
          [80, 140],
          [160, 140],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="1" fill="var(--line)" />
        ))}

        {/* Dashed geofence circle */}
        <circle
          cx="120"
          cy="100"
          r="80"
          stroke="var(--line)"
          strokeWidth="1"
          strokeDasharray="6 4"
          className={prefersReducedMotion ? "" : "geofence-circle"}
        />

        {/* Tick marks around geofence */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
          const rad = (deg * Math.PI) / 180;
          const x1 = 120 + Math.cos(rad) * 74;
          const y1 = 100 + Math.sin(rad) * 74;
          const x2 = 120 + Math.cos(rad) * 80;
          const y2 = 100 + Math.sin(rad) * 80;
          return (
            <line
              key={deg}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="var(--line)"
              strokeWidth="1"
            />
          );
        })}

        {/* Radius annotation */}
        <line
          x1="120"
          y1="78"
          x2="200"
          y2="78"
          stroke="var(--line)"
          strokeWidth="1"
          strokeDasharray="2 2"
        />
        <text
          x="160"
          y="74"
          fill="var(--ink)"
          fontFamily="var(--font-mono)"
          fontSize="7"
          textAnchor="middle"
          opacity="0.8"
        >
          radius 150m
        </text>

        {/* Location pin: outer circle */}
        <circle
          cx="120"
          cy="100"
          r="18"
          stroke="var(--ink)"
          strokeWidth="1.5"
        />
        {/* Location pin: center dot */}
        <circle cx="120" cy="100" r="4" fill="var(--primary)" />
        {/* Crosshair ticks */}
        <line
          x1="120"
          y1="78"
          x2="120"
          y2="84"
          stroke="var(--ink)"
          strokeWidth="1"
        />
        <line
          x1="120"
          y1="116"
          x2="120"
          y2="122"
          stroke="var(--ink)"
          strokeWidth="1"
        />
        <line
          x1="98"
          y1="100"
          x2="104"
          y2="100"
          stroke="var(--ink)"
          strokeWidth="1"
        />
        <line
          x1="136"
          y1="100"
          x2="142"
          y2="100"
          stroke="var(--ink)"
          strokeWidth="1"
        />

        {/* QR token label box */}
        <rect
          x="205"
          y="56"
          width="90"
          height="28"
          rx="2"
          stroke="var(--ink)"
          strokeWidth="1"
          fill="var(--surface)"
        />
        <text
          x="212"
          y="68"
          fill="var(--ink)"
          fontFamily="var(--font-mono)"
          fontSize="9"
          letterSpacing="0.04em"
        >
          QR TOKEN
        </text>
        <text
          x="212"
          y="78"
          fill="var(--ink)"
          fontFamily="var(--font-mono)"
          fontSize="8"
          letterSpacing="0.02em"
        >
          tkn_8f2a1d3c
        </text>

        {/* Accuracy readout */}
        <rect
          x="205"
          y="90"
          width="74"
          height="20"
          rx="2"
          stroke="var(--line)"
          strokeWidth="1"
          fill="var(--surface)"
        />
        <text
          x="212"
          y="98"
          fill="var(--ink)"
          fontFamily="var(--font-mono)"
          fontSize="7"
          opacity="0.7"
        >
          ACCURACY
        </text>
        <text
          x="212"
          y="106"
          fill="var(--ink)"
          fontFamily="var(--font-mono)"
          fontSize="8"
        >
          ±4m
        </text>

        {/* Inspection stamp */}
        <rect
          x="195"
          y="132"
          width="110"
          height="56"
          rx="2"
          stroke="var(--ink)"
          strokeWidth="1"
          fill="var(--surface)"
        />
        <text
          x="205"
          y="152"
          fill="var(--status-complete)"
          fontFamily="var(--font-mono)"
          fontSize="10"
          fontWeight="600"
          letterSpacing="0.08em"
        >
          VERIFIED
        </text>
        <text
          x="205"
          y="168"
          fill="var(--ink)"
          fontFamily="var(--font-mono)"
          fontSize="9"
          letterSpacing="0.02em"
        >
          LOC 94
        </text>
        <text
          x="205"
          y="180"
          fill="var(--ink)"
          fontFamily="var(--font-mono)"
          fontSize="9"
          letterSpacing="0.02em"
        >
          CLEAN 91
        </text>

        {/* Site marker in lower left */}
        <g transform="translate(38, 148)">
          <rect
            x="0"
            y="0"
            width="28"
            height="20"
            rx="1"
            stroke="var(--line)"
            strokeWidth="1"
          />
          <line
            x1="0"
            y1="10"
            x2="28"
            y2="10"
            stroke="var(--line)"
            strokeWidth="1"
          />
          <line
            x1="14"
            y1="0"
            x2="14"
            y2="20"
            stroke="var(--line)"
            strokeWidth="1"
          />
          <circle cx="14" cy="10" r="2" fill="var(--primary)" />
        </g>

        {/* Coordinate label */}
        <text
          x="48"
          y="184"
          fill="var(--ink)"
          fontFamily="var(--font-mono)"
          fontSize="7"
          opacity="0.7"
        >
          24.8607°N 67.0011°E
        </text>

        {/* North indicator */}
        <text
          x="120"
          y="25"
          fill="var(--ink)"
          fontFamily="var(--font-mono)"
          fontSize="8"
          textAnchor="middle"
          opacity="0.6"
        >
          N
        </text>
        <line
          x1="120"
          y1="28"
          x2="120"
          y2="34"
          stroke="var(--line)"
          strokeWidth="1"
        />
      </svg>
    </figure>
  );
}
