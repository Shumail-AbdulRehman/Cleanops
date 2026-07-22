import { useState } from "react";

function AreaSinkSvg() {
  return (
    <svg viewBox="0 0 400 300" className="h-full w-full" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sink area reference">
      {/* Wall */}
      <rect x="0" y="0" width="400" height="300" fill="var(--surface)" />
      {/* Tile grid */}
      <g stroke="var(--line)" strokeWidth="1" opacity="0.6">
        {[40, 80, 120, 160, 200, 240, 280, 320, 360].map((x) => (
          <line key={`v${x}`} x1={x} y1="0" x2={x} y2="300" />
        ))}
        {[40, 80, 120, 160, 200, 240, 280].map((y) => (
          <line key={`h${y}`} x1="0" y1={y} x2="400" y2={y} />
        ))}
      </g>
      {/* Mirror cabinet */}
      <rect x="110" y="20" width="180" height="120" rx="1" stroke="var(--ink)" strokeWidth="2" fill="color-mix(in oklab, var(--surface) 70%, white)" />
      <line x1="200" y1="20" x2="200" y2="140" stroke="var(--ink)" strokeWidth="1.5" />
      <line x1="110" y1="80" x2="290" y2="80" stroke="var(--ink)" strokeWidth="1" opacity="0.3" />
      {/* Vanity */}
      <rect x="60" y="155" width="280" height="18" rx="1" stroke="var(--ink)" strokeWidth="1.5" fill="var(--surface)" />
      {/* Sink basin */}
      <path d="M 110 155 L 120 235 C 120 250 280 250 280 235 L 290 155 Z" stroke="var(--ink)" strokeWidth="2" fill="color-mix(in oklab, var(--surface) 60%, white)" />
      <ellipse cx="200" cy="235" rx="78" ry="12" stroke="var(--line)" strokeWidth="1" fill="none" />
      {/* Faucet */}
      <path d="M 200 155 L 200 130 Q 200 100 230 105 L 235 106" stroke="var(--ink)" strokeWidth="4" fill="none" strokeLinecap="round" />
      <circle cx="236" cy="106" r="4" stroke="var(--primary)" strokeWidth="2" fill="var(--surface)" />
      {/* Soap dispenser */}
      <rect x="305" y="120" width="16" height="35" rx="2" stroke="var(--ink)" strokeWidth="1.5" fill="var(--surface)" />
      <rect x="308" y="112" width="10" height="8" rx="1" stroke="var(--ink)" strokeWidth="1.5" fill="var(--surface)" />
      {/* Cabinet below */}
      <rect x="80" y="250" width="240" height="50" rx="1" stroke="var(--ink)" strokeWidth="1.5" fill="var(--surface)" />
      <line x1="200" y1="250" x2="200" y2="300" stroke="var(--ink)" strokeWidth="1" />
      <circle cx="190" cy="275" r="3" stroke="var(--ink)" strokeWidth="1" fill="none" />
      <circle cx="210" cy="275" r="3" stroke="var(--ink)" strokeWidth="1" fill="none" />
    </svg>
  );
}

function AreaMirrorSvg() {
  return (
    <svg viewBox="0 0 400 300" className="h-full w-full" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mirror area reference">
      {/* Wall */}
      <rect x="0" y="0" width="400" height="300" fill="var(--surface)" />
      {/* Tile grid */}
      <g stroke="var(--line)" strokeWidth="1" opacity="0.6">
        {[40, 80, 120, 160, 200, 240, 280, 320, 360].map((x) => (
          <line key={`v${x}`} x1={x} y1="0" x2={x} y2="300" />
        ))}
        {[40, 80, 120, 160, 200, 240, 280].map((y) => (
          <line key={`h${y}`} x1="0" y1={y} x2="400" y2={y} />
        ))}
      </g>
      {/* Large mirror */}
      <rect x="100" y="25" width="200" height="140" rx="1" stroke="var(--ink)" strokeWidth="2.5" fill="color-mix(in oklab, var(--surface) 75%, white)" />
      {/* Mirror reflection lines */}
      <line x1="120" y1="45" x2="120" y2="145" stroke="var(--line)" strokeWidth="2" />
      <line x1="140" y1="45" x2="140" y2="145" stroke="var(--line)" strokeWidth="1" />
      <line x1="160" y1="45" x2="160" y2="145" stroke="var(--line)" strokeWidth="1" />
      <line x1="180" y1="45" x2="180" y2="145" stroke="var(--line)" strokeWidth="1" />
      <line x1="200" y1="45" x2="200" y2="145" stroke="var(--line)" strokeWidth="1" />
      {/* Light fixture */}
      <rect x="130" y="8" width="140" height="12" rx="1" stroke="var(--ink)" strokeWidth="1.5" fill="var(--surface)" />
      <line x1="130" y1="14" x2="270" y2="14" stroke="var(--primary)" strokeWidth="1" />
      {/* Counter */}
      <rect x="70" y="170" width="260" height="16" rx="1" stroke="var(--ink)" strokeWidth="1.5" fill="var(--surface)" />
      {/* Basin */}
      <ellipse cx="200" cy="195" rx="70" ry="14" stroke="var(--ink)" strokeWidth="2" fill="color-mix(in oklab, var(--surface) 60%, white)" />
      <ellipse cx="200" cy="195" rx="55" ry="9" stroke="var(--line)" strokeWidth="1" fill="none" />
      {/* Faucet */}
      <path d="M 200 170 L 200 150 Q 200 125 175 130" stroke="var(--ink)" strokeWidth="3" fill="none" strokeLinecap="round" />
      <circle cx="173" cy="130" r="3" stroke="var(--primary)" strokeWidth="1.5" fill="var(--surface)" />
      {/* Soap */}
      <rect x="290" y="150" width="18" height="20" rx="2" stroke="var(--ink)" strokeWidth="1.5" fill="var(--surface)" />
      <rect x="292" y="146" width="14" height="4" rx="1" stroke="var(--ink)" strokeWidth="1" fill="var(--surface)" />
      {/* Vanity cabinet */}
      <rect x="90" y="220" width="220" height="80" rx="1" stroke="var(--ink)" strokeWidth="1.5" fill="var(--surface)" />
      <line x1="200" y1="220" x2="200" y2="300" stroke="var(--ink)" strokeWidth="1" />
      <circle cx="185" cy="260" r="3" stroke="var(--ink)" strokeWidth="1" fill="none" />
      <circle cx="215" cy="260" r="3" stroke="var(--ink)" strokeWidth="1" fill="none" />
    </svg>
  );
}

function AreaFloorSvg() {
  return (
    <svg viewBox="0 0 400 300" className="h-full w-full" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Floor area reference">
      {/* Back wall */}
      <rect x="0" y="0" width="400" height="300" fill="var(--surface)" />
      {/* Floor perspective tiles */}
      <g stroke="var(--line)" strokeWidth="1" opacity="0.7">
        <line x1="0" y1="300" x2="200" y2="110" />
        <line x1="80" y1="300" x2="210" y2="110" />
        <line x1="160" y1="300" x2="220" y2="110" />
        <line x1="240" y1="300" x2="230" y2="110" />
        <line x1="320" y1="300" x2="240" y2="110" />
        <line x1="400" y1="300" x2="250" y2="110" />
        <line x1="400" y1="220" x2="0" y2="220" />
        <line x1="400" y1="260" x2="0" y2="260" />
        <line x1="400" y1="170" x2="0" y2="170" />
      </g>
      {/* Back wall / door frame */}
      <rect x="140" y="20" width="120" height="90" rx="1" stroke="var(--ink)" strokeWidth="2" fill="none" />
      <line x1="200" y1="20" x2="200" y2="110" stroke="var(--ink)" strokeWidth="1.5" />
      <circle cx="210" cy="65" r="3" stroke="var(--ink)" strokeWidth="1" fill="none" />
      {/* Side wall fixtures */}
      <rect x="20" y="35" width="80" height="50" rx="1" stroke="var(--ink)" strokeWidth="1.5" fill="color-mix(in oklab, var(--surface) 60%, white)" />
      <rect x="30" y="45" width="60" height="30" rx="1" stroke="var(--line)" strokeWidth="1" fill="none" />
      <rect x="300" y="40" width="70" height="45" rx="1" stroke="var(--ink)" strokeWidth="1.5" fill="color-mix(in oklab, var(--surface) 60%, white)" />
      {/* Mop */}
      <line x1="260" y1="280" x2="320" y2="80" stroke="var(--ink)" strokeWidth="5" strokeLinecap="round" />
      <rect x="235" y="275" width="70" height="18" rx="2" stroke="var(--ink)" strokeWidth="2" fill="color-mix(in oklab, var(--surface) 50%, white)" />
      <line x1="235" y1="282" x2="305" y2="282" stroke="var(--line)" strokeWidth="1" />
      <line x1="235" y1="286" x2="305" y2="286" stroke="var(--line)" strokeWidth="1" />
      {/* Reflection highlight */}
      <path d="M 120 240 L 200 120" stroke="var(--primary)" strokeWidth="2" opacity="0.5" />
    </svg>
  );
}

const singleArea = {
  area: "sink_area",
  loc: 94,
  clean: 91,
  reason: "fixtures align; minor streaks on mirror",
};

const multiAreas = [
  { area: "SINK", loc: 94, clean: 91, reason: "counter geometry matches reference", render: <AreaSinkSvg /> },
  { area: "MIRROR", loc: 88, clean: 87, reason: "reflection aligns; minor streaks noted", render: <AreaMirrorSvg /> },
  { area: "FLOOR", loc: 96, clean: 93, reason: "tile pattern and grout lines match", render: <AreaFloorSvg /> },
];

function Frame({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col border border-ink rounded-[2px] bg-surface overflow-hidden">
      <div className="border-b border-line px-3 py-2">
        <span className="font-mono text-[10px] font-medium uppercase tracking-widest text-ink/70">
          {label}
        </span>
      </div>
      <div className="aspect-[4/3] p-3">
        {children ?? <AreaSinkSvg />}
      </div>
    </div>
  );
}

export function VerificationDiagram() {
  const [mode, setMode] = useState<"single" | "multi">("single");

  return (
    <div className="space-y-6">
      {/* Tab toggle */}
      <div className="inline-flex border border-ink rounded-[2px]" role="tablist" aria-label="Verification mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "single"}
          onClick={() => setMode("single")}
          className={`px-4 py-2 font-mono text-[10px] uppercase tracking-wider transition-colors ${
            mode === "single"
              ? "bg-ink text-surface"
              : "bg-surface text-ink hover:bg-ink/5"
          }`}
        >
          Single area
        </button>
        <div className="w-px bg-line" />
        <button
          type="button"
          role="tab"
          aria-selected={mode === "multi"}
          onClick={() => setMode("multi")}
          className={`px-4 py-2 font-mono text-[10px] uppercase tracking-wider transition-colors ${
            mode === "multi"
              ? "bg-ink text-surface"
              : "bg-surface text-ink hover:bg-ink/5"
          }`}
        >
          Multi-area
        </button>
      </div>

      {mode === "single" ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Frame label="Reference" />
            <Frame label="Submitted" />
          </div>
          <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
            <p className="font-mono text-xs text-ink">
              <span className="text-ink/60">{singleArea.area}</span>{" "}
              <span className="text-status-complete">LOC {singleArea.loc}</span>{" "}
              <span className="text-status-complete">CLEAN {singleArea.clean}</span>
            </p>
            <p className="font-mono text-xs text-ink/70">
              reason: {singleArea.reason}
            </p>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          {multiAreas.map((area) => (
            <div key={area.area} className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-ink/70">
                  Area: {area.area}
                </span>
                <p className="font-mono text-xs text-ink">
                  <span className="text-status-complete">LOC {area.loc}</span>{" "}
                  <span className="text-status-complete">CLEAN {area.clean}</span>
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Frame label={`Reference · ${area.area}`}>{area.render}</Frame>
                <Frame label={`Submitted · ${area.area}`}>{area.render}</Frame>
              </div>
              <p className="font-mono text-xs text-ink/70">reason: {area.reason}</p>
            </div>
          ))}
        </div>
      )}

      {/* Reasoning block */}
      <div className="border border-line rounded-[2px] bg-surface p-4">
        <div className="grid gap-2 font-mono text-xs text-ink sm:grid-cols-3">
          <p>
            <span className="text-ink/60">submission_id</span>{" "}
            sub_8f2a1d3c
          </p>
          <p>
            <span className="text-ink/60">location_match</span>{" "}
            <span className="text-status-complete">94</span>
          </p>
          <p>
            <span className="text-ink/60">cleanliness_match</span>{" "}
            <span className="text-status-complete">91</span>
          </p>
        </div>
        <p className="mt-3 font-mono text-xs text-ink/70">
          reason: counter geometry and fixture positions match reference; mirror shows minor streaks below threshold.
        </p>
      </div>
    </div>
  );
}
