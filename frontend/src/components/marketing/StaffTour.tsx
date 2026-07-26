import { useEffect, useRef, useState } from "react";
import { ArrowRight, Clock3, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { QrPattern } from "./ProductParts";
import { prefersCalm, useFirstSeen } from "./useFirstSeen";

const steps = [
  "Check in at the right location",
  "Scan a QR code to start a task",
  "Submit photos as each area is finished",
];
const managerView = [
  ["Ali’s ready for the day", "Checked in at Building A"],
  ["Ali started a task", "Second-floor washroom, 10:02"],
  ["Photos arrived", "Waiting for a manager’s review"],
];

function Screen({ step }: { step: number }) {
  if (step === 0) {
    return (
      <div className="hv-view">
        <p className="hv-hi">Good morning, Ali</p>
        <h3>Let’s make it a good shift.</h3>
        <div className="hv-map-card">
          <svg viewBox="0 0 280 110" aria-hidden="true">
            <rect width="280" height="110" fill="#e2e9f3" />
            <path d="M-5 42 285 26M92-5l14 120M196-5l10 120" stroke="#fff" strokeWidth="9" fill="none" />
            <circle cx="140" cy="62" r="40" fill="#4264d9" fillOpacity=".16" stroke="#4264d9" strokeWidth="1.5" strokeDasharray="4 4" />
            <circle cx="140" cy="62" r="7" fill="#4264d9" stroke="#fff" strokeWidth="2.5" />
          </svg>
          <p>
            <b>Building A</b>
            <span>
              <MapPin aria-hidden="true" />
              24 Main Boulevard
            </span>
            <span>
              <Clock3 aria-hidden="true" />
              8:00 am to 5:00 pm
            </span>
          </p>
        </div>
        <p className="hv-inside">
          <i />
          Inside the check-in boundary
        </p>
        <span className="hv-cta">Check in with selfie</span>
      </div>
    );
  }
  if (step === 1) {
    return (
      <div className="hv-view">
        <p className="hv-hi">Next task</p>
        <h3>Second-floor washroom</h3>
        <div className="hv-scan">
          <div className="hv-qr">
            <QrPattern />
          </div>
          <i />
          <i />
          <i />
          <i />
          <u />
        </div>
        <p className="hv-inside">
          <i />
          Point at the tag on the wall
        </p>
        <span className="hv-cta">Scan the task QR</span>
      </div>
    );
  }
  return (
    <div className="hv-view">
      <p className="hv-hi">Second-floor washroom</p>
      <h3>Photo 2 of 3: Table top</h3>
      <div className="hv-shot">
        <img src="/photos/surface-cleaning-640.webp" alt="" loading="lazy" />
      </div>
      <div className="hv-bars" aria-hidden="true">
        <i className="on" />
        <i className="on" />
        <i />
      </div>
      <span className="hv-cta">Take photo</span>
    </div>
  );
}

export function StaffTour() {
  const [step, setStep] = useState(0);
  const [sectionRef, seen] = useFirstSeen<HTMLElement>(0.5);
  const held = useRef(false);
  const stopped = useRef(false);

  // Walks through the steps once. Hover or focus holds it, and a click ends it.
  useEffect(() => {
    if (!seen || prefersCalm()) return;
    const timer = window.setInterval(() => {
      if (held.current) return;
      if (stopped.current) {
        window.clearInterval(timer);
        return;
      }
      setStep((current) => {
        if (current >= steps.length - 1) {
          stopped.current = true;
          return current;
        }
        return current + 1;
      });
    }, 3400);
    return () => window.clearInterval(timer);
  }, [seen]);

  const hold = (value: boolean) => () => {
    held.current = value;
  };

  return (
    <section
      ref={sectionRef}
      className="hv-phone"
      aria-labelledby="hv-phone-title"
      onMouseEnter={hold(true)}
      onMouseLeave={hold(false)}
      onFocus={hold(true)}
      onBlur={hold(false)}
    >
      <div className="marketing-container hv-phone-grid">
        <div className="hv-phone-stage">
          <div className="hv-device" role="group" aria-label="Sample staff app">
            <div className="hv-screen">
              <div className="hv-status" aria-hidden="true">
                <span>9:41</span>
                <i />
              </div>
              <Screen key={step} step={step} />
            </div>
          </div>
          <div className="hv-echo" role="status">
            <small>What the manager sees</small>
            <b>{managerView[step][0]}</b>
            <span>{managerView[step][1]}</span>
          </div>
        </div>
        <div className="hv-phone-copy">
          <h2 id="hv-phone-title">
            A clear next step.
            <br />
            Right in their pocket.
          </h2>
          <p>
            Give your team a straightforward way to check in, find their tasks,
            and show their work. All from their phone.
          </p>
          <ol className="hv-steps" aria-label="Staff app steps">
            {steps.map((label, index) => (
              <li key={label}>
                <button
                  type="button"
                  aria-pressed={index === step}
                  className={index < step ? "is-done" : undefined}
                  onClick={() => {
                    stopped.current = true;
                    setStep(index);
                  }}
                >
                  <i aria-hidden="true" />
                  {label}
                </button>
              </li>
            ))}
          </ol>
          <Link className="hv-more" to="/features#attendance">
            Explore the staff experience <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
