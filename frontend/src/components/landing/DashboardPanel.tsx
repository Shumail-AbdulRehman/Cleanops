type Status = "complete" | "progress" | "missed" | "pending";

interface Row {
  location: string;
  status: Status;
  label: string;
  detail: string;
}

const statusClasses: Record<Status, string> = {
  complete: "text-status-complete border-status-complete",
  progress: "text-status-progress border-status-progress",
  missed: "text-status-missed border-status-missed",
  pending: "text-status-pending border-status-pending",
};

function StatusTag({ status, children }: { status: Status; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider rounded-[2px] ${statusClasses[status]}`}
    >
      {children}
    </span>
  );
}

export function DashboardPanel({ rows }: { rows: Row[] }) {
  return (
    <div className="border border-line rounded-[2px] bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="font-mono text-[10px] font-medium uppercase tracking-widest text-ink">
          Today Status
        </span>
        <span className="font-mono text-[10px] text-ink/70">08:32 PKT</span>
      </div>
      <div className="divide-y divide-line">
        {rows.map((row) => (
          <div key={row.location} className="flex items-center justify-between px-4 py-3">
            <span className="font-mono text-xs uppercase tracking-wide text-ink">
              {row.location}
            </span>
            <div className="flex items-center gap-3">
              <StatusTag status={row.status}>{row.label}</StatusTag>
              <span className="hidden font-mono text-[10px] text-ink/70 sm:inline">
                {row.detail}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
