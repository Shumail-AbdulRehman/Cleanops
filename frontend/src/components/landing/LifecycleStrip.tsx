export function LifecycleStrip() {
  const ticks = [
    { label: "QR SCAN", time: "09:12" },
    { label: "GEOFENCE", time: "09:12" },
    { label: "PHOTO UPLOAD", time: "09:14" },
    { label: "SCORED", time: "09:15", active: true },
    { label: "DASHBOARD", time: "09:15" },
  ];

  const total = ticks.length - 1;
  const startX = 32;
  const endX = 288;
  const y = 60;

  return (
    <figure className="w-full overflow-hidden" aria-label="Task lifecycle timeline">
      <div className="border border-line rounded-[2px] bg-surface p-4">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-ink/70">
          Task lifecycle
        </div>
        <svg
          viewBox="0 0 320 120"
          className="h-auto w-full"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
        >
          {/* Horizontal baseline */}
          <line x1={startX} y1={y} x2={endX} y2={y} stroke="var(--line)" strokeWidth="1" />

          {/* Progress highlight up to active tick */}
          {ticks.findIndex((t) => t.active) >= 0 && (
            <line
              x1={startX}
              y1={y}
              x2={startX + (endX - startX) * (ticks.findIndex((t) => t.active) / total)}
              y2={y}
              stroke="var(--primary)"
              strokeWidth="1"
            />
          )}

          {/* Task ID label above line */}
          <text
            x={startX}
            y={y - 20}
            fill="var(--ink)"
            fontFamily="var(--font-mono)"
            fontSize="8"
            letterSpacing="0.02em"
          >
            TASK_2026-08-26_TPL-17
          </text>

          {ticks.map((tick, i) => {
            const x = startX + (endX - startX) * (i / total);
            const color = tick.active ? "var(--primary)" : "var(--line)";
            return (
              <g key={tick.label}>
                {/* Tick mark */}
                <line x1={x} y1={y - 6} x2={x} y2={y + 6} stroke={color} strokeWidth="1.5" />
                {/* Time + label below */}
                <text
                  x={x}
                  y={y + 22}
                  fill={color}
                  fontFamily="var(--font-mono)"
                  fontSize="8"
                  textAnchor="middle"
                  letterSpacing="0.02em"
                >
                  {tick.time}
                </text>
                <text
                  x={x}
                  y={y + 34}
                  fill={tick.active ? "var(--ink)" : "var(--line)"}
                  fontFamily="var(--font-mono)"
                  fontSize="7"
                  textAnchor="middle"
                  letterSpacing="0.04em"
                >
                  {tick.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}
