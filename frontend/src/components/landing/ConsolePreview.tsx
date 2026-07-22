const screenshots = [
  {
    src: "/console-today-status.webp",
    alt: "Today Status dashboard showing absences, pending work, and review items",
    label: "DAILY TRIAGE",
    title: "Today Status",
    description: "See who is absent, what tasks are pending, and which records need manager review before the day closes.",
  },
  {
    src: "/console-staff-record.webp",
    alt: "Staff record page with profile, task performance, and attendance summary",
    label: "STAFF RECORD",
    title: "Per-person history",
    description: "Open any staff member to see their profile, task performance chart, and attendance reliability for the month.",
  },
  {
    src: "/console-admin-dashboard.webp",
    alt: "Admin dashboard showing locations, active staff, task templates, and operational load",
    label: "ADMIN DASHBOARD",
    title: "Operational overview",
    description: "Track total locations, active staff, task templates, and site-level load across the whole workspace.",
  },
];

function ScreenshotFrame({
  src,
  alt,
  label,
  title,
  description,
}: {
  src: string;
  alt: string;
  label: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col">
      <div className="overflow-hidden border border-line rounded-[2px] bg-surface">
        <img
          src={src}
          alt={alt}
          className="h-auto w-full object-cover"
          loading="lazy"
        />
      </div>
      <div className="mt-3">
        <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-ink/50">
          {label}
        </p>
        <h3 className="font-heading mt-1 text-lg font-semibold tracking-tight text-ink">
          {title}
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-ink/70">{description}</p>
      </div>
    </div>
  );
}

export function ConsolePreview() {
  return (
    <section className="border-b border-line px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="max-w-2xl">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-ink/70">
            Console Preview
          </p>
          <h2 className="font-heading mt-3 text-[clamp(2rem,4vw,3rem)] font-bold leading-[1.05] tracking-tight text-ink">
            See the manager console in action.
          </h2>
          <p className="mt-4 text-lg leading-8 text-ink/70">
            Hygene Ops gives managers one place to triage the day, inspect staff records, and review operational load across every location.
          </p>
        </div>

        <div className="mt-10 grid gap-8 md:grid-cols-3">
          {screenshots.map((shot) => (
            <ScreenshotFrame key={shot.label} {...shot} />
          ))}
        </div>
      </div>
    </section>
  );
}
