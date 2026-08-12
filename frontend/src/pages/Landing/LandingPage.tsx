import { Play } from "lucide-react";
import { HeroWorkspace } from "@/components/marketing/HeroWorkspace";
import { MarketingCTA, WorkspaceLink } from "@/components/marketing/MarketingCTA";
import { PaperLogWipe } from "@/components/marketing/PaperLogWipe";
import { TaskTicks } from "@/components/marketing/ProductParts";
import { ProductVideo } from "@/components/marketing/ProductVideo";
import { StaffTour } from "@/components/marketing/StaffTour";

const spaces = [
  ["Offices", "Reception, washrooms, meeting rooms"],
  ["Retail", "Shop floors, stock rooms, entrances"],
  ["Healthcare", "Wards, waiting areas, washrooms"],
  ["Hospitality", "Rooms, lobbies, kitchens"],
  ["Shared spaces", "Stairs, corridors, common areas"],
];
const sites: [string, number, number][] = [
  ["Building A", 12, 14],
  ["Mall Road Hotel", 8, 8],
  ["Gulberg Clinic", 6, 10],
  ["Liberty Market", 9, 11],
  ["DHA Office", 2, 6],
];
const alerts = [
  ["9:18", "Hina hasn’t checked in at Building B", "Late arrival"],
  ["12:40", "Lobby floors not started, due at 12:00", "Overdue task"],
  ["3:05", "Kitchen photos are waiting for a manager", "Needs review"],
  ["Mon", "Ali didn’t check out at Building A", "Missed checkout"],
];

export default function LandingPage() {
  return (
    <>
      <section className="hv-hero" aria-labelledby="hv-title">
        <div className="marketing-container hv-copy">
          <h1 id="hv-title">
            Great cleaning.
            <br />
            <span>Less managing.</span>
          </h1>
          <p className="hv-lede">
            Bring your team, tasks, and locations together. Know who’s on site,
            what’s getting done, and where you’re needed.
          </p>
          <div className="hv-actions">
            <WorkspaceLink className="hx-btn hx-btn-blue" />
            <a className="hv-see" href="#watch">
              <Play aria-hidden="true" />
              See how it works<small>1:30</small>
            </a>
          </div>
          <p className="hv-note">
            Made for cleaning businesses. Create your account first, then choose
            your plan.
          </p>
        </div>
        <HeroWorkspace />
      </section>

      <section className="hv-spaces" aria-label="Spaces Hygene Ops is made for">
        <div className="marketing-container">
          <p>For the spaces your team takes care of</p>
          <dl>
            {spaces.map(([name, areas]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{areas}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="hv-op" id="product-tour" aria-labelledby="hv-op-title">
        <div className="marketing-container">
          <div className="hv-op-head">
            <h2 id="hv-op-title">
              Your whole operation.
              <br />
              Finally on the same page.
            </h2>
            <p>
              From the first check-in to the last task of the day, keep the
              details connected.
            </p>
          </div>
          <div className="hv-op-grid">
            <article className="hv-a">
              <h3>Every location, in view</h3>
              <p>
                Give each site its own team, schedule, and clear picture of
                progress.
              </p>
              <ul className="hv-a-sites" aria-label="Sample progress by site">
                {sites.map(([name, done, total]) => (
                  <li key={name}>
                    <b>{name}</b>
                    <TaskTicks done={done} total={total} />
                    <small>
                      {done} of {total}
                    </small>
                  </li>
                ))}
              </ul>
            </article>
            <article className="hv-b">
              <h3>Everyone knows the plan</h3>
              <p>
                Staff see their shifts and tasks. Managers see what needs
                attention.
              </p>
              <dl>
                <div>
                  <dt>Ali sees</dt>
                  <dd>Next: Second-floor washroom, 12:00</dd>
                </div>
                <div>
                  <dt>Sara sees</dt>
                  <dd>2 things need attention at Building A</dd>
                </div>
              </dl>
            </article>
            <article className="hv-c">
              <h3>Work you can follow up on</h3>
              <p>Keep attendance, task history, and photo evidence together.</p>
              <ol aria-label="Sample task history">
                <li>
                  <time>7:56</time>Checked in
                </li>
                <li>
                  <time>10:02</time>QR scanned
                </li>
                <li>
                  <time>10:31</time>3 photos sent
                </li>
              </ol>
            </article>
          </div>
          <p className="hx-sample">Sample data.</p>
        </div>
      </section>

      <StaffTour />
      <ProductVideo />
      <PaperLogWipe />

      <section className="hx-attention" aria-labelledby="attention-title">
        <div className="marketing-container hx-attention-grid">
          <div>
            <h2 id="attention-title">Most of the day needs nothing from you.</h2>
            <p>
              Hygene Ops brings up the few things that do, with the name, the
              place and the time.
            </p>
          </div>
          <ul className="hx-alerts" aria-label="Examples of what needs attention">
            {alerts.map(([time, title, kind]) => (
              <li key={title}>
                <time>{time}</time>
                <div>
                  <b>{title}</b>
                  <span>{kind}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <MarketingCTA />
    </>
  );
}
