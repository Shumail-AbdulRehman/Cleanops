import { useEffect, useState } from "react";
import { prefersCalm, useFirstSeen } from "./useFirstSeen";

const REST = 40;
const paperTimes = ["8:00", "10:00", "12:00", "2:00", "4:00", "6:00"];

function Who({ mark, name }: { mark: string; name: string }) {
  return (
    <span className="hx-who">
      <i>{mark}</i>
      {name}
    </span>
  );
}

function Thumbs() {
  return (
    <span className="hx-thumbs">
      <i />
      <i />
      <i />
    </span>
  );
}

export function PaperLogWipe() {
  const [wrapRef, seen] = useFirstSeen<HTMLDivElement>(0.55);
  const [position, setPosition] = useState(() => (prefersCalm() ? REST : 100));
  const [demo, setDemo] = useState(false);

  // The log wipes itself once, showing visitors what the handle does.
  useEffect(() => {
    if (!seen || prefersCalm()) return;
    const frame = window.requestAnimationFrame(() => {
      setDemo(true);
      setPosition(REST);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [seen]);

  return (
    <section className="hx-log" id="proof" aria-labelledby="log-title">
      <div className="marketing-container">
        <div className="hx-log-intro">
          <h2 id="log-title">You know the sheet on the washroom door.</h2>
          <p>
            Every box ticked, in the same pen, and the 6 pm row signed at 2. Wipe
            across it to see the same day in Hygene Ops, where a tick comes with a
            name, a place and a photo.
          </p>
        </div>

        <div
          ref={wrapRef}
          className={demo ? "hx-wipe is-demo" : "hx-wipe"}
          style={{ "--pos": `${position}%` } as React.CSSProperties}
          onTransitionEnd={() => setDemo(false)}
        >
          <div className="hx-sheet hx-paper" aria-hidden="true">
            <i className="hx-tape hx-tape-l" />
            <i className="hx-tape hx-tape-r" />
            <header className="hx-sheet-head">
              <strong>Toilet cleaning checklist</strong>
              <span>
                Floor 2 &nbsp; Month: <b className="hx-hand">Nov</b>
              </span>
            </header>
            <div className="hx-row hx-row-head">
              <span>Time</span>
              <span>Cleaned by</span>
              <span>Floor</span>
              <span>Basin</span>
              <span>Sign</span>
            </div>
            {paperTimes.map((time) => (
              <div className="hx-row" key={time}>
                <span>{time}</span>
                <span className="hx-hand">Ali</span>
                <span className="hx-hand">&#x2713;</span>
                <span className="hx-hand">&#x2713;</span>
                <span className="hx-sign" />
              </div>
            ))}
            <i className="hx-ring" />
          </div>

          <div className="hx-sheet hx-record">
            <header className="hx-sheet-head">
              <strong>Second-floor washroom</strong>
              <span>Building A, today</span>
            </header>
            <div className="hx-row hx-row-head">
              <span>Time</span>
              <span>Cleaned by</span>
              <span>On site</span>
              <span>Photos</span>
              <span>Status</span>
            </div>
            <div className="hx-row">
              <span>8:02</span>
              <Who mark="AR" name="Ali Raza" />
              <span className="hx-ok">GPS and QR</span>
              <Thumbs />
              <span className="hx-st hx-st-ok">Verified</span>
            </div>
            <div className="hx-row">
              <span>10:04</span>
              <Who mark="AR" name="Ali Raza" />
              <span className="hx-ok">GPS and QR</span>
              <Thumbs />
              <span className="hx-st hx-st-ok">Verified</span>
            </div>
            <div className="hx-row hx-row-alert">
              <span>12:00</span>
              <span>Not started</span>
              <span>No check-in</span>
              <span>None</span>
              <span className="hx-st hx-st-warn">Overdue</span>
            </div>
            <div className="hx-row">
              <span>2:07</span>
              <Who mark="OK" name="Omar Khan" />
              <span className="hx-ok">GPS and QR</span>
              <Thumbs />
              <span className="hx-st">Submitted</span>
            </div>
            <div className="hx-row hx-row-later">
              <span>4:00</span>
              <span>Omar Khan</span>
              <span>Later</span>
              <span>Due at 4:30</span>
              <span className="hx-st">Scheduled</span>
            </div>
            <div className="hx-row hx-row-later">
              <span>6:00</span>
              <span>Omar Khan</span>
              <span>Later</span>
              <span>Due at 6:30</span>
              <span className="hx-st">Scheduled</span>
            </div>
          </div>

          <div className="hx-wipe-handle" aria-hidden="true">
            <span>
              <svg viewBox="0 0 24 24">
                <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />
              </svg>
            </span>
          </div>
          <input
            className="hx-wipe-range"
            type="range"
            min="0"
            max="100"
            value={position}
            aria-label="Wipe between the paper log and the Hygene Ops record"
            onChange={(event) => {
              setDemo(false);
              setPosition(Number(event.target.value));
            }}
          />
        </div>
        <p className="hx-sample">Drag across the sheet. Sample data.</p>
      </div>
    </section>
  );
}
