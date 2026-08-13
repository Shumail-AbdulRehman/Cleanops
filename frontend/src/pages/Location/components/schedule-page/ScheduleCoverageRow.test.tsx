import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LanguageContext } from "@/i18n/context";
import { translate } from "@/i18n/translations";
import { WEEKDAYS } from "@/lib/workDays";
import type { ScheduleCoverageDay } from "../../schedulePageModel";
import { ScheduleCoverageRow } from "./ScheduleCoverageRow";

const jobs = [12, 13, 14, 13, 17, 14, 10];
const staff = [4, 4, 5, 4, 6, 4, 3];
const open = [0, 1, 0, 0, 0, 0, 2];
const coverage: ScheduleCoverageDay[] = WEEKDAYS.map((weekday, index) => ({
  weekday,
  date: `2026-11-${16 + index}`,
  jobs: jobs[index],
  staffOn: staff[index],
  open: open[index],
  load: jobs[index] / 17,
  isToday: weekday === "SUN",
}));

function coverageProps() {
  return {
    coverage,
    weekLabel: "16–22 Nov 2026",
    selectedWeekday: null,
    onChooseDay: vi.fn(),
    onPreviousWeek: vi.fn(),
    onNextWeek: vi.fn(),
    onThisWeek: vi.fn(),
  };
}

describe("ScheduleCoverageRow", () => {
  it("names all seven day buttons with their dates and counts", () => {
    render(<ScheduleCoverageRow {...coverageProps()} />);

    const days = screen.getAllByRole("button", { pressed: false });
    const names = [
      "Monday 16 November 2026, 12 jobs, 4 staff",
      "Tuesday 17 November 2026, 13 jobs, 4 staff, 1 open",
      "Wednesday 18 November 2026, 14 jobs, 5 staff",
      "Thursday 19 November 2026, 13 jobs, 4 staff",
      "Friday 20 November 2026, 17 jobs, 6 staff",
      "Saturday 21 November 2026, 14 jobs, 4 staff",
      "Sunday 22 November 2026, Today, 10 jobs, 3 staff, 2 open",
    ];
    expect(days).toHaveLength(names.length);
    names.forEach((name, index) => expect(days[index]).toHaveAccessibleName(name));
    expect(days[0]).toHaveTextContent(/Mon 16.*12 jobs.*4 staff/);
    expect(within(days[6]).getByText("Today")).toBeVisible();
  });

  it("shows open counts only on days with open jobs", () => {
    render(<ScheduleCoverageRow {...coverageProps()} />);

    expect(screen.getAllByText(/^\d+ open$/).map(count => count.textContent)).toEqual([
      "1 open",
      "2 open",
    ]);
    const monday = screen.getByRole("button", { name: /^Monday/ });
    expect(within(monday).queryByText(/open/)).not.toBeInTheDocument();
  });

  it("reports the chosen weekday and reflects the parent's selection", () => {
    const props = coverageProps();
    const { rerender } = render(<ScheduleCoverageRow {...props} />);
    const tuesday = screen.getByRole("button", { name: /^Tuesday/, pressed: false });

    fireEvent.click(tuesday);
    expect(props.onChooseDay).toHaveBeenCalledExactlyOnceWith("TUE");
    rerender(<ScheduleCoverageRow {...props} selectedWeekday="TUE" />);
    expect(screen.getAllByRole("button", { pressed: true })).toEqual([tuesday]);
  });

  it("reports previous, next and this week and isolates the week range", () => {
    const props = coverageProps();
    render(<ScheduleCoverageRow {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    expect(props.onPreviousWeek).toHaveBeenCalledTimes(1);
    expect(props.onNextWeek).toHaveBeenCalledTimes(1);
    expect(props.onThisWeek).toHaveBeenCalledTimes(1);
    expect(screen.getByText(props.weekLabel)).toHaveAttribute("dir", "ltr");
  });

  it("renders Urdu navigation, weekdays and counts", () => {
    render(
      <LanguageContext.Provider
        value={{
          language: "ur",
          setLanguage: vi.fn(),
          t: (key, values) => translate(key, "ur", values),
        }}
      >
        <ScheduleCoverageRow {...coverageProps()} />
      </LanguageContext.Provider>,
    );

    expect(screen.getByRole("button", { name: "پچھلا ہفتہ" })).toBeVisible();
    expect(screen.getByRole("button", { name: "اگلا ہفتہ" })).toBeVisible();
    expect(screen.getByRole("button", { name: "یہ ہفتہ" })).toBeVisible();
    const sunday = screen.getByRole("button", {
      name: /^اتوار.+آج.+10 کام.+3 افراد.+2 کام بغیر کارکن کے$/,
    });
    expect(sunday).toHaveTextContent(/اتوار 22.*آج.*10 کام.*3 افراد.*2 کام بغیر کارکن کے/);
  });
});
