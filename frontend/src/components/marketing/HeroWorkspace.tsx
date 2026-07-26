import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Building2,
  CalendarDays,
  Check,
  CheckCheck,
  LayoutGrid,
  Users,
} from "lucide-react";
import BrandLogo from "@/components/common/BrandLogo";
import { prefersCalm } from "./useFirstSeen";

const tabs = ["Overview", "Attendance", "Tasks"] as const;
const rail = [
  [LayoutGrid, "Overview"],
  [Building2, "Locations"],
  [Users, "Team"],
  [CalendarDays, "Attendance"],
  [CheckCheck, "Tasks"],
] as const;

type Row = {
  mark: string;
  tint?: "b" | "c";
  title: string;
  detail: string;
  middle: string;
  value?: number;
  status: string;
  tone?: "prog" | "ok" | "warn";
};

function SiteRow({ row }: { row: Row }) {
  return (
    <div className="hv-site">
      <i className={row.tint}>{row.mark}</i>
      <p>
        {row.title}
        <small>{row.detail}</small>
      </p>
      <div className="hv-prog">
        <span>{row.middle}</span>
        {row.value !== undefined && (
          <u style={{ "--v": row.value } as React.CSSProperties} />
        )}
      </div>
      <em className={row.tone}>{row.status}</em>
    </div>
  );
}

export function HeroWorkspace() {
  const [tab, setTab] = useState(0);
  const [finished, setFinished] = useState(prefersCalm);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // One task finishes shortly after the page opens.
  useEffect(() => {
    if (finished) return;
    const timer = window.setTimeout(() => setFinished(true), 1700);
    return () => window.clearTimeout(timer);
  }, [finished]);

  const panels: Row[][] = [
    [
      { mark: "BA", title: "Building A", detail: "Commercial office", middle: "12 / 14", value: 0.857, status: "In progress", tone: "prog" },
      { mark: "MH", tint: "b", title: "Mall Road Hotel", detail: "Hospitality", middle: "8 / 8", value: 1, status: "Complete", tone: "ok" },
      { mark: "GC", tint: "c", title: "Gulberg Clinic", detail: "Healthcare", middle: finished ? "7 / 10" : "6 / 10", value: finished ? 0.7 : 0.6, status: "In progress", tone: "prog" },
    ],
    [
      { mark: "AR", title: "Ali Raza", detail: "Building A", middle: "7:56", status: "On time", tone: "ok" },
      { mark: "OK", tint: "c", title: "Omar Khan", detail: "Gulberg Clinic", middle: "8:03", status: "On time", tone: "ok" },
      { mark: "HB", tint: "b", title: "Hina Bibi", detail: "Mall Road Hotel", middle: "8:18", status: "Late", tone: "warn" },
    ],
    [
      { mark: "GC", tint: "c", title: "Reception and lobby", detail: "Sana Noor", middle: "Due 10:00", status: "Submitted", tone: "ok" },
      { mark: "BA", title: "Second-floor washroom", detail: "Ali Raza", middle: "Due 12:00", status: "In progress", tone: "prog" },
      { mark: "MH", tint: "b", title: "Kitchen", detail: "Omar Khan", middle: "Due 15:00", status: "Scheduled" },
    ],
  ];

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + tabs.length) % tabs.length;
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="hv-stage">
      <div className="hv-dash" role="group" aria-label="Sample Hygene Ops workspace">
        <aside className="hv-rail" aria-hidden="true">
          <BrandLogo />
          <div className="hv-co">
            <i>SC</i>
            <p>
              Sparkle Cleaning<small>Your workspace</small>
            </p>
          </div>
          <ul>
            {rail.map(([Icon, label], index) => (
              <li key={label} className={index === 0 ? "on" : undefined}>
                <Icon />
                {label}
              </li>
            ))}
          </ul>
        </aside>
        <div className="hv-main">
          <header>
            <h2>A good day starts here.</h2>
            <p>Here’s how your team is getting on.</p>
          </header>
          <div className="hv-stats">
            <div>
              <small>Active locations</small>
              <b>3</b>
              <em>All covered</em>
            </div>
            <div>
              <small>Staff checked in</small>
              <b>18</b>
              <span>/ 20</span>
            </div>
            <div>
              <small>Tasks complete</small>
              <b>{finished ? 27 : 26}</b>
              <span>/ 32</span>
            </div>
          </div>
          <div className="hv-tabs" role="tablist" aria-label="Workspace view">
            {tabs.map((label, index) => (
              <button
                key={label}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                role="tab"
                type="button"
                id={`hv-tab-${index}`}
                aria-controls={`hv-panel-${index}`}
                aria-selected={tab === index}
                tabIndex={tab === index ? 0 : -1}
                onClick={() => setTab(index)}
                onKeyDown={(event) => onKeyDown(event, index)}
              >
                {label}
              </button>
            ))}
          </div>
          {panels.map((rows, index) => (
            <div
              key={tabs[index]}
              role="tabpanel"
              id={`hv-panel-${index}`}
              aria-labelledby={`hv-tab-${index}`}
              hidden={tab !== index}
            >
              {rows.map((row) => (
                <SiteRow key={row.title} row={row} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className={finished ? "hv-toast" : "hv-toast is-pre"} role="status">
        <span aria-hidden="true">
          <Check />
        </span>
        <p>
          <b>Another task, taken care of.</b>Reception and lobby. Photo submitted.
        </p>
        <time>Just now</time>
      </div>
      <p className="hv-caption">Sample data. Try the tabs.</p>
    </div>
  );
}
