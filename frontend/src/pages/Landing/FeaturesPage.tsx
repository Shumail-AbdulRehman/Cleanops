import { useEffect, useRef, useState } from "react";
import { MarketingCTA, WorkspaceLink } from "@/components/marketing/MarketingCTA";
import { QrPattern, TaskTicks } from "@/components/marketing/ProductParts";
import { useFirstSeen } from "@/components/marketing/useFirstSeen";

const floors = [
  { id: "locations", no: "4", name: "Locations", short: "Locations", detail: "Every site, its team and its shifts" },
  { id: "attendance", no: "3", name: "Attendance", short: "Attendance", detail: "Who is on site, and since when" },
  { id: "scheduling", no: "2", name: "Scheduling", short: "Scheduling", detail: "Daily routines and one-time jobs" },
  { id: "verification", no: "1", name: "Photo proof", short: "Photo proof", detail: "The evidence stays with the task" },
  { id: "roles", no: "G", name: "Roles and language", short: "Roles", detail: "Owner, manager and staff, in English or Urdu" },
];

const sites: [string, string, string, number, number, string][] = [
  ["Building A", "Commercial office", "6 of 6", 12, 14, "Sara Ahmed"],
  ["Building B", "Hospital wing", "5 of 6", 6, 10, "Sara Ahmed"],
  ["Gulberg Plaza", "Shopping floors", "8 of 8", 8, 8, "Usman Tariq"],
  ["Mall Road Hotel", "Rooms and lobby", "4 of 4", 3, 12, "Usman Tariq"],
];
const checkIns = [
  ["AR", "Ali Raza", "7:56", "ok", "On time"],
  ["SN", "Sana Noor", "7:58", "ok", "On time"],
  ["OK", "Omar Khan", "8:03", "ok", "On time"],
  ["HB", "Hina Bibi", "8:18", "warn", "Late"],
];
const week = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const roles = [
  ["Locations", "All sites", "Assigned sites", "Where they work"],
  ["Attendance", "Everyone", "Their sites", "Their own"],
  ["Tasks", "Create and assign", "Create and assign", "Do and submit"],
  ["Photo review", "Yes", "Their sites", "Own submissions"],
  ["Plan and billing", "Yes", "No", "No"],
];
const appText = {
  en: { title: "Today’s tasks", rows: ["Check in", "Scan the task QR", "Start cleaning", "Take photo"] },
  ur: { title: "آج کے کام", rows: ["حاضری لگائیں", "کام کا QR اسکین کریں", "صفائی شروع کریں", "تصویر لیں"] },
};

function FloorHead({ no, id, title, children }: { no: string; id: string; title: string; children: React.ReactNode }) {
  return (
    <header className="hx-floor-head">
      <b aria-hidden="true">{no}</b>
      <div>
        <h2 id={id}>{title}</h2>
        <p>{children}</p>
      </div>
    </header>
  );
}

/** The lift panel appears past the lobby and follows the floor in view. */
function LiftPanel({ lobby }: { lobby: React.RefObject<HTMLElement | null> }) {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState(floors[0].id);
  useEffect(() => {
    if (typeof window.IntersectionObserver !== "function") return;
    const floorObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setCurrent(entry.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const floor of floors) {
      const element = document.getElementById(floor.id);
      if (element) floorObserver.observe(element);
    }
    const lobbyObserver = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { rootMargin: "-120px 0px 0px 0px" },
    );
    if (lobby.current) lobbyObserver.observe(lobby.current);
    return () => {
      floorObserver.disconnect();
      lobbyObserver.disconnect();
    };
  }, [lobby]);
  return (
    <nav className={visible ? "hx-lift is-on" : "hx-lift"} aria-label="Jump to a floor">
      {floors.map((floor) => (
        <a
          key={floor.id}
          href={`#${floor.id}`}
          aria-label={`Floor ${floor.no}, ${floor.name}`}
          aria-current={current === floor.id ? "true" : undefined}
        >
          <b>{floor.no}</b>
          <span>{floor.short}</span>
        </a>
      ))}
    </nav>
  );
}

function LanguagePreview() {
  const [language, setLanguage] = useState<"en" | "ur">("en");
  const text = appText[language];
  return (
    <div className="hx-lang" data-lang={language}>
      <div className="hx-lang-switch" role="group" aria-label="Preview language">
        <button type="button" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>
          English
        </button>
        <button type="button" lang="ur" aria-pressed={language === "ur"} onClick={() => setLanguage("ur")}>
          اردو
        </button>
      </div>
      <div className="hx-lang-screen" lang={language === "ur" ? "ur" : undefined}>
        <h3>{text.title}</h3>
        {text.rows.map((row, index) => (
          <span key={row} className={index === text.rows.length - 1 ? "hx-lang-row is-primary" : "hx-lang-row"}>
            <span>{row}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function FeaturesPage() {
  const lobby = useRef<HTMLElement>(null);
  const [sitesRef, sitesSeen] = useFirstSeen<HTMLDivElement>(0.3);
  return (
    <>
      <section className="hx-lobby" aria-labelledby="lobby-title" ref={lobby}>
        <div className="marketing-container hx-lobby-grid">
          <div className="hx-lobby-copy">
            <h1 id="lobby-title">Everything Hygene Ops does, floor by floor.</h1>
            <p>
              From the site list at the top to who can see what at the bottom.
              Press a floor or keep scrolling.
            </p>
            <WorkspaceLink className="hx-btn hx-btn-blue" />
          </div>
          <nav className="hx-directory" aria-label="Features by floor">
            {floors.map((floor) => (
              <a key={floor.id} href={`#${floor.id}`}>
                <b>{floor.no}</b>
                <span>
                  {floor.name}
                  <small>{floor.detail}</small>
                </span>
              </a>
            ))}
          </nav>
        </div>
      </section>

      <LiftPanel lobby={lobby} />

      <section className="hx-floor" id="locations" aria-labelledby="f4">
        <div className="marketing-container">
          <FloorHead no="4" id="f4" title="Each site keeps its own team, shifts and tasks.">
            Managers get the sites they look after and nothing else. Owners see
            all of them on one list.
          </FloorHead>
          <div ref={sitesRef} className={sitesSeen ? "hx-sites" : "hx-sites is-pre"} role="table" aria-label="Sample sites">
            <div className="hx-sites-row hx-sites-head" role="row">
              <span role="columnheader">Site</span>
              <span role="columnheader">On shift</span>
              <span role="columnheader">Tasks done today</span>
              <span role="columnheader">Manager</span>
            </div>
            {sites.map(([name, kind, shift, done, total, manager]) => (
              <div className="hx-sites-row" role="row" key={name}>
                <span role="cell">
                  <b>{name}</b>
                  <small>{kind}</small>
                </span>
                <span role="cell">{shift}</span>
                <span role="cell">
                  <TaskTicks done={done} total={total} />
                </span>
                <span role="cell">{manager}</span>
              </div>
            ))}
          </div>
          <p className="hx-sample">Sample data.</p>
        </div>
      </section>

      <section className="hx-floor hx-floor-tint" id="attendance" aria-labelledby="f3">
        <div className="marketing-container">
          <FloorHead no="3" id="f3" title="Know who is on site without phoning anyone.">
            Staff check in with their location and a selfie. Each site has its
            own boundary, and late arrivals and missed checkouts show up on their
            own.
          </FloorHead>
          <div className="hx-map">
            <svg viewBox="0 0 1180 520" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Street map with a check-in boundary around Building A">
              <rect width="1180" height="520" fill="#fff" />
              <g fill="#e2e9f3">
                <path d="M-10 -10h292l17 200H-10z" />
                <path d="M322 -10h200l16 186H336z" />
                <path d="M566 -10h206l15 172H580z" />
                <path d="M816 -10h380v150H828z" />
                <path d="M-10 234h306l13 150H-10z" />
                <path d="M348 224h236l12 170H360z" />
                <path d="M628 216h184l12 186H640z" />
                <path d="M858 188h340v214H870z" />
                <path d="M-10 430h336l10 100H-10z" />
                <path d="M372 442h252l6 90H378z" />
                <path d="M672 446h156l6 86H678z" />
                <path d="M874 448h320v84H880z" />
              </g>
              <path d="M430 262h104v104H430z" fill="#21334b" />
              <circle cx="482" cy="314" r="168" fill="#4264d9" fillOpacity=".13" stroke="#4264d9" strokeWidth="2" strokeDasharray="7 7" />
              <text x="482" y="394" textAnchor="middle" fontSize="16" fontWeight="650" fill="#21334b">Building A</text>
              <text x="482" y="466" textAnchor="middle" fontSize="14" fill="#3455c5">Check-in boundary</text>
              <g stroke="#fff" strokeWidth="3">
                <circle cx="394" cy="262" r="10" fill="#0f7a52" />
                <circle cx="560" cy="248" r="10" fill="#0f7a52" />
                <circle cx="572" cy="384" r="10" fill="#0f7a52" />
                <circle cx="722" cy="198" r="10" fill="#e0a800" />
              </g>
            </svg>
            <div className="hx-checkins">
              <p>
                <b>Check-ins</b>
                <span>Building A, today</span>
              </p>
              <ul>
                {checkIns.map(([mark, name, time, tone, status]) => (
                  <li key={name}>
                    <i>{mark}</i>
                    <span>{name}</span>
                    <time>{time}</time>
                    <em className={tone}>{status}</em>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="hx-sample">Sample map and names.</p>
        </div>
      </section>

      <section className="hx-floor hx-floor-blue" id="scheduling" aria-labelledby="f2">
        <div className="marketing-container">
          <FloorHead no="2" id="f2" title="Set the routine once. Tasks appear every day.">
            Daily routines, one-time jobs and shifts that run past midnight, each
            in the local time of its site. Automatic assignment is on Pro and
            Enterprise.
          </FloorHead>
          <div className="hx-week" role="img" aria-label="Sample week: floors and washrooms every day, an overnight lobby clean from Friday night to Saturday morning, and a one-time deep clean on Saturday">
            <div className="hx-week-days">
              <span />
              {week.map((day) => (
                <span key={day} className={day === "Thu" ? "is-today" : undefined}>
                  {day}
                </span>
              ))}
            </div>
            <div className="hx-week-row">
              <span className="hx-week-label">Floor cleaning</span>
              <i className="d" style={{ gridColumn: "2/9" }}>Every day, 8:00</i>
            </div>
            <div className="hx-week-row">
              <span className="hx-week-label">Washrooms</span>
              <i className="d" style={{ gridColumn: "2/7" }}>Mon to Fri, 8:00, 12:00 and 4:00</i>
            </div>
            <div className="hx-week-row">
              <span className="hx-week-label">Lobby</span>
              <i className="n" style={{ gridColumn: "6/8" }}>Overnight, Fri 22:00 to Sat 6:00</i>
            </div>
            <div className="hx-week-row">
              <span className="hx-week-label">Kitchen</span>
              <i className="o" style={{ gridColumn: "7/8" }}>Deep clean</i>
            </div>
          </div>
          <p className="hx-sample hx-sample-light">Sample schedule. Yellow is a one-time job.</p>
        </div>
      </section>

      <section className="hx-floor" id="verification" aria-labelledby="f1">
        <div className="marketing-container">
          <FloorHead no="1" id="f1" title="The photos stay with the task that needed them.">
            Staff scan the tag on the wall to start, then take the photos each
            area asks for. Managers see them against the task, the person and the
            time.
          </FloorHead>
          <div className="hx-proof">
            <div className="hx-tag-card">
              <div className="hx-qr">
                <QrPattern />
              </div>
              <p>
                <b>Second-floor washroom</b>
                <span>Scan to start this task</span>
              </p>
            </div>
            <figure className="hx-photo">
              <img src="/photos/surface-cleaning-1200.webp" alt="A gloved hand wiping a table with a blue cloth" loading="lazy" />
              <figcaption>
                <b>Table top</b>
                <span>Required photo 2 of 3</span>
                <a href="https://www.pexels.com/photo/close-up-photo-of-person-cleaning-the-table-4099467/" target="_blank" rel="noreferrer">
                  Photo: Matilda Wormwood
                </a>
              </figcaption>
            </figure>
            <ol className="hx-states">
              <li className="done">
                <b>Submitted</b>
                <span>Ali sent the required photos at 10:04.</span>
              </li>
              <li className="done">
                <b>Verified</b>
                <span>The photos passed their checks.</span>
              </li>
              <li>
                <b>Review closed</b>
                <span>A manager has settled anything flagged.</span>
              </li>
            </ol>
          </div>
          <p className="hx-planned">
            <em>Planned</em> AI review to bring up the photos a manager should
            look at first. Managers keep the final say.
          </p>
        </div>
      </section>

      <section className="hx-floor hx-floor-tint" id="roles" aria-labelledby="fg">
        <div className="marketing-container">
          <FloorHead no="G" id="fg" title="Everyone sees their part, in their language.">
            The staff app works in English and Urdu, so instructions reach the
            people doing the work.
          </FloorHead>
          <div className="hx-roles">
            <table>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">What</span>
                  </th>
                  <th scope="col">Owner</th>
                  <th scope="col">Manager</th>
                  <th scope="col">Staff</th>
                </tr>
              </thead>
              <tbody>
                {roles.map(([name, owner, manager, staff]) => (
                  <tr key={name}>
                    <th scope="row">{name}</th>
                    <td>{owner}</td>
                    <td>{manager}</td>
                    <td>{staff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <LanguagePreview />
          </div>
        </div>
      </section>

      <MarketingCTA />
    </>
  );
}
