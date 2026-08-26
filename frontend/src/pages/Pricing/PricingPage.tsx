import { useState } from "react";
import useAuth from "@/hooks/useAuth";
import { MarketingCTA } from "@/components/marketing/MarketingCTA";
import { PaddlePricing } from "./PaddlePricing";

const faqs = [
  [
    "How do I get started?",
    "Choose Starter or Pro to carry your plan and billing interval into signup. Enterprise checkout is available in owner billing when the configured catalog includes it; otherwise, contact us to discuss your requirements. After checkout confirms your subscription, you can add locations, create staff accounts, and set up your first tasks.",
  ],
  [
    "What counts as a manager seat?",
    "Your company administrator counts as one manager seat. Pro includes additional manager seats. For Enterprise, we will discuss how many seats your operation needs. Managers can be assigned to specific locations. Staff accounts have their own separate allowance.",
  ],
  [
    "Can my staff use Hygene Ops on their phones?",
    "Yes. The staff app supports check-in, QR scanning, and task photo submissions. Your team can follow their assigned work from a mobile device.",
  ],
  [
    "What happens if I reach a plan limit?",
    "Your existing resources stay in place. To add more active locations, staff, or managers than your plan allows, choose a plan with higher limits.",
  ],
  [
    "How do I manage my subscription?",
    "Your company administrator can open Plan & usage in the workspace and select Manage billing to access the Paddle customer portal.",
  ],
  [
    "Why are prices shown in my local currency?",
    "Paddle localizes prices for your region. Your final total and any applicable taxes are shown during checkout before you confirm.",
  ],
];

const PLAN_LIMITS = [
  { name: "Starter", locations: 1, staff: 3, managers: 1 },
  { name: "Pro", locations: 5, staff: 25, managers: 3 },
];
type Size = { locations: number; staff: number; managers: number };

function Stepper({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (value: number) => void }) {
  return (
    <span className="hx-step">
      <button type="button" aria-label={`Fewer ${label}`} disabled={value <= 1} onClick={() => onChange(value - 1)}>
        &minus;
      </button>
      <output aria-label={label}>{value}</output>
      <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </span>
  );
}

function fitFor(size: Size) {
  const index = PLAN_LIMITS.findIndex(
    (plan) => size.locations <= plan.locations && size.staff <= plan.staff && size.managers <= plan.managers,
  );
  return index === -1 ? 2 : index;
}

function FinderResult({ size, fit }: { size: Size; fit: number }) {
  if (fit === 2) {
    return (
      <>
        <b>Enterprise fits.</b> <span>You’re past what Pro allows, so let’s agree a scope with your team.</span>
      </>
    );
  }
  const plan = PLAN_LIMITS[fit];
  const room = [
    [plan.locations - size.locations, "location", "locations"],
    [plan.staff - size.staff, "staff member", "staff"],
  ].flatMap(([spare, one, many]) => (Number(spare) > 0 ? [`${spare} more ${spare === 1 ? one : many}`] : []));
  return (
    <>
      <b>{plan.name} fits.</b>{" "}
      <span>{room.length ? `You’d have room for ${room.join(" and ")}.` : "That uses the whole plan."}</span>
    </>
  );
}

export default function PricingPage() {
  const { user } = useAuth();
  const cannotSubscribe = user?.role === "MANAGER" || user?.role === "STAFF";
  const [size, setSize] = useState<Size>({ locations: 3, staff: 12, managers: 2 });
  const fit = fitFor(size);
  const update = (key: keyof Size) => (value: number) => setSize((current) => ({ ...current, [key]: value }));

  return (
    <>
      <section className="hx-finder" aria-labelledby="finder-title">
        <div className="marketing-container">
          <h1 id="finder-title">Plans differ by size, so tell us yours.</h1>
          <p className="hx-finder-sentence">
            We clean <Stepper label="locations" value={size.locations} max={50} onChange={update("locations")} />{" "}
            {size.locations === 1 ? "location" : "locations"} with{" "}
            <Stepper label="staff" value={size.staff} max={500} onChange={update("staff")} /> staff and{" "}
            <Stepper label="managers" value={size.managers} max={50} onChange={update("managers")} />{" "}
            {size.managers === 1 ? "manager" : "managers"}.
          </p>
          <p className="hx-finder-result" role="status" key={fit}>
            <FinderResult size={size} fit={fit} />
          </p>
        </div>
      </section>

      <section className="hx-plans" aria-label="Subscription plans">
        <div className="marketing-container">
          <PaddlePricing
            fit={fit}
            inquiry={{ locations: size.locations, staff: size.staff }}
            subscribeDisabled={cannotSubscribe}
            disabledMessage="Only the company administrator can subscribe for this workspace."
          />
        </div>
      </section>

      <section className="hx-faq" aria-labelledby="faq-title">
        <div className="marketing-container hx-faq-grid">
          <h2 id="faq-title">Before you sign up</h2>
          <div className="hx-faq-list">
            {faqs.map(([question, answer], index) => (
              <details key={question} open={index === 0}>
                <summary>{question}</summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <MarketingCTA />
    </>
  );
}
