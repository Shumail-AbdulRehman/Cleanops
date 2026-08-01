import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import StatusBadge from "@/components/common/StatusBadge";
import { LanguageContext } from "@/i18n/context";
import { translate, type Language } from "@/i18n/translations";
import { avatarTint } from "./avatarTint";
import { PersonAvatar } from "./PersonAvatar";
import { SiteAvatar } from "./SiteAvatar";
import { StatusPill } from "./StatusPill";
import { TaskTicks } from "./TaskTicks";
import { MeterRow } from "./MeterRow";
import type { ReactNode } from "react";

function Language({ children, language = "en" }: { children: ReactNode; language?: Language }) {
  return (
    <LanguageContext.Provider value={{ language, setLanguage: () => {}, t: (text, values) => translate(text, language, values) }}>
      <div dir={language === "ur" ? "rtl" : "ltr"} lang={language}>{children}</div>
    </LanguageContext.Provider>
  );
}

describe("shared identity and progress parts", () => {
  it.each([["", 0], ["A", 5], ["B", 0], ["AB", 5], ["😀", 1]] as const)(
    "assigns %j the documented UTF-16 tint %i", (name, tint) => {
      expect(avatarTint(name)).toBe(tint);
      expect(avatarTint(name)).toBe(tint);
    },
  );

  it("uses all six tints and stays in range for Urdu and long names", () => {
    expect(new Set(["B", "C", "D", "E", "F", "A"].map(avatarTint)).size).toBe(6);
    for (const name of ["علی رضا", "نام".repeat(10000)]) {
      expect(avatarTint(name)).toBeGreaterThanOrEqual(0);
      expect(avatarTint(name)).toBeLessThan(6);
    }
  });

  it("keeps person and site tint identical across separate page instances", () => {
    const name = "علی رضا";
    const { container } = render(<><section><PersonAvatar name={name} /></section><section><SiteAvatar name={name} /></section><section><PersonAvatar name={name} /></section></>);
    const avatars = [...container.querySelectorAll('section > [aria-hidden="true"]')];
    expect(avatars).toHaveLength(3);
    for (const avatar of avatars) expect(avatar).toHaveClass(`wx-avatar--tint-${avatarTint(name)}`);
  });

  for (const Avatar of [PersonAvatar, SiteAvatar]) {
    describe(Avatar.name, () => {
      it.each(["small", "default", "large"] as const)("renders a decorative %s drawing without accessible or focusable content", size => {
        const { container } = render(<Avatar name="Identity" size={size} />);
        expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
        expect(container.querySelector("svg")).toHaveAttribute("focusable", "false");
        expect(screen.queryByRole("img")).not.toBeInTheDocument();
        expect(container.querySelector('[tabindex="0"], button, a, img')).toBeNull();
      });

      it.each([undefined, null, "", " \t "])("shows only a dashed empty variant for unassigned %j", name => {
        const { container } = render(<Avatar name={name} />);
        expect(container.firstElementChild).toHaveClass("wx-avatar--empty");
        expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
        expect(container.querySelector("svg")).toBeNull();
        expect(container.textContent).toBe("");
      });
    });
  }

  it.each(["neutral", "ok", "progress", "attention", "bad"] as const)("keeps visible text for the %s pill tone", tone => {
    render(<StatusPill tone={tone}>Needs review</StatusPill>);
    expect(screen.getByText("Needs review")).toBeVisible();
  });

  it.each(["PENDING", "IN_PROGRESS", "COMPLETED", "NOT_COMPLETED_INTIME", "CHECKED_IN", "CHECKED_OUT", "MISSED_CHECKOUT", "ABSENT", "SHIFT_NOT_STARTED", "NO_RECORD_TODAY", "ACTIVE", "CANCELLED", "NEW_STATE"])(
    "reuses StatusBadge's existing label for %s", status => {
      render(<><section aria-label="Existing vocabulary"><StatusBadge status={status} /></section><section aria-label="New visual"><StatusPill status={status} /></section></>);
      const existing = screen.getByRole("region", { name: "Existing vocabulary" }).textContent!;
      expect(within(screen.getByRole("region", { name: "New visual" })).getByText(existing)).toBeVisible();
    },
  );

  it.each([undefined, null, "", "   "])("renders a text fallback for an absent or blank status %j", status => {
    render(<StatusPill status={status}>{" "}</StatusPill>);
    expect(screen.getByText("Unknown")).toBeVisible();
  });

  it("keeps submitted, verified and review closed labels separate", () => {
    render(<><StatusPill tone="progress">Submitted</StatusPill><StatusPill tone="ok">Verified</StatusPill><StatusPill>Review closed</StatusPill></>);
    for (const text of ["Submitted", "Verified", "Review closed"]) expect(screen.getByText(text)).toBeVisible();
  });

  it("exposes the task count once and draws only completed check marks", () => {
    render(<TaskTicks done={3} total={5} />);
    const ticks = screen.getByRole("img", { name: "3 of 5 tasks done" });
    expect(ticks.querySelectorAll("svg")).toHaveLength(3);
    expect(ticks.firstElementChild?.children).toHaveLength(5);
    expect(ticks.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("keeps 24 boxes but changes to a bounded meter at 25", () => {
    const { rerender } = render(<TaskTicks done={24} total={24} />);
    expect(screen.getByRole("img").firstElementChild?.children).toHaveLength(24);
    rerender(<TaskTicks done={12} total={25} />);
    const meter = screen.getByRole("img", { name: "12 of 25 tasks done" }).firstElementChild!;
    expect(meter.children).toHaveLength(1);
    expect(meter.firstElementChild).toHaveStyle({ inlineSize: "48%" });
    expect(meter.querySelector("svg")).toBeNull();
    rerender(<TaskTicks done={500000} total={1000000} />);
    expect(screen.getByRole("img", { name: "500000 of 1000000 tasks done" }).querySelectorAll("*")).toHaveLength(2);
  });

  it.each([[0, 0, "0 of 0"], [-1, 5, "0 of 5"], [9, 5, "5 of 5"], [2.9, 5.9, "2 of 5"], [NaN, Infinity, "0 of 0"]] as const)(
    "normalizes invalid task counts (%s, %s)", (done, total, phrase) => {
      render(<TaskTicks done={done} total={total} />);
      expect(screen.getByRole("img", { name: `${phrase} tasks done` })).toBeInTheDocument();
    },
  );

  it("renders the meter's name, figure, optional subline and accessible range", () => {
    render(<MeterRow name="Site record" figure="6 of 10" value={6} max={10} subline="Work submitted" />);
    const meter = screen.getByRole("meter", { name: "Site record" });
    expect(screen.getByText("6 of 10")).toBeVisible();
    expect(screen.getByText("Work submitted")).toBeVisible();
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "10");
    expect(meter).toHaveAttribute("aria-valuenow", "6");
    expect(meter).toHaveAttribute("aria-valuetext", "6 of 10");
    expect(meter.firstElementChild).toHaveStyle({ inlineSize: "60%" });
  });

  it.each(["submitted", "attendance"] as const)("supports %s meter tone without requiring a subline", tone => {
    render(<MeterRow name="Scope" figure="75%" value={75} tone={tone} />);
    expect(screen.getByRole("meter", { name: "Scope" })).toHaveAttribute("aria-valuenow", "75");
    expect(screen.getByText("75%")).toBeVisible();
  });

  it.each([[-5, 0], [120, 100]])("keeps meter value %i within the accessible range", (value, expected) => {
    render(<MeterRow name="Scope" figure={value} value={value} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", String(expected));
  });

  it.each([[null, 100], [NaN, 100], [Infinity, 100], [5, 0], [5, Infinity]])("does not turn missing or invalid meter data (%s / %s) into zero", (value, max) => {
    render(<MeterRow name="Scope" figure="50%" value={value} max={max!} />);
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeVisible();
    expect(screen.queryByText("50%")).not.toBeInTheDocument();
    expect(screen.getByRole("img")).not.toHaveAttribute("aria-valuenow");
  });

  it("translates interface copy and task counts in Urdu while preserving record names and figures", () => {
    render(<Language language="ur"><StatusPill status="PENDING" /><StatusPill tone="progress">Submitted</StatusPill><TaskTicks done={3} total={5} /><MeterRow name="Work submitted" figure="6 / 10" value={6} max={10} subline="Work submitted" /></Language>);
    expect(screen.getByText(translate("Not started", "ur"))).toBeVisible();
    expect(screen.getByText(translate("Submitted", "ur"))).toBeVisible();
    expect(screen.getByRole("img", { name: translate("{count} of {total} tasks done", "ur", { count: 3, total: 5 }) })).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Work submitted" })).toHaveAttribute("aria-valuetext", "6 / 10");
    expect(screen.getByText(translate("Work submitted", "ur"))).toBeVisible();
  });
});
