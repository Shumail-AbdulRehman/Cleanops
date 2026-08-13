import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageContext } from "@/i18n/context";
import { translate, type Language } from "@/i18n/translations";
import { WEEKDAYS, WEEKDAY_LABELS } from "@/lib/workDays";
import type { ScheduleRow, ScheduleStaffWeekRow, ScheduleWorker } from "../../schedulePageModel";
import { ScheduleStaffWeek, type ScheduleStaffWeekProps } from "./ScheduleStaffWeek";

afterEach(cleanup);

const worker: ScheduleWorker = {
  id: 10,
  name: "Ayesha Noor",
  workDays: ["MON", "TUE", "WED", "THU", "FRI"],
  shiftText: "07:00–15:00",
};

const dates = WEEKDAYS.map((weekday, index) => ({ date: `2026-11-${16 + index}`, weekday }));
const jobs: ScheduleRow[] = [
  ["07:00", "Lobby mop"],
  ["07:30", "Desk wipe"],
  ["08:00", "Restock"],
  ["08:30", "Floor sweep"],
  ["09:00", "Washroom reset"],
].map(([start, title], index) => ({
  id: index + 1,
  title,
  worker,
  areaId: 1,
  areaName: "A block",
  start,
  end: "09:30",
  duration: null,
  overnight: false,
  fixturesChoice: "ALL",
  recurringType: "ONCE",
  weekdays: ["MON"],
  effectiveDate: dates[0].date,
  onceDate: dates[0].date,
  futureStartDate: null,
  inactive: false,
  needsReview: false,
}));

const openJob: ScheduleRow = {
  ...jobs[0], id: 6, title: "Entry sweep", worker: null, start: "08:15", end: "08:30",
};

const rows: ScheduleStaffWeekRow[] = [
  {
    worker: null,
    count: 1,
    days: dates.map((day, index) => ({ ...day, dayOff: false, jobs: index === 0 ? [openJob] : [] })),
  },
  {
    worker,
    count: jobs.length,
    days: dates.map((day, index) => ({ ...day, dayOff: index >= 5, jobs: index === 0 ? jobs : [] })),
  },
];

function renderWeek(language: Language = "en") {
  const props: ScheduleStaffWeekProps = {
    rows,
    days: dates.map((day, index) => ({
      date: day.date,
      label: `${translate(WEEKDAY_LABELS[day.weekday].short, language)} ${16 + index}`,
      isToday: index === 0,
    })),
    agenda: [...jobs.slice(0, 3), openJob, ...jobs.slice(3)],
    agendaLabel: language === "en" ? "Mon 16 Nov" : "پیر 16 نومبر",
    onOpen: vi.fn(),
  };
  render(
    <LanguageContext.Provider value={{
      language,
      setLanguage: vi.fn(),
      t: (key, values) => translate(key, language, values),
    }}>
      <ScheduleStaffWeek {...props} />
    </LanguageContext.Provider>,
  );
  return props;
}

function getWorkerRow() {
  const table = within(screen.getByRole("table", { name: "Week" }));
  return within(table.getByRole("row", { name: /^Ayesha Noor/ }));
}

describe("ScheduleStaffWeek", () => {
  it("shows the Staff and date headers, marking today in words", () => {
    renderWeek();
    const table = within(screen.getByRole("table", { name: "Week" }));
    expect(table.getAllByRole("columnheader")).toHaveLength(8);
    expect(table.getByRole("columnheader", { name: "Staff" })).toBeVisible();
    expect(table.getByRole("columnheader", { name: "Mon 16 · Today" })).toBeVisible();
  });

  it("puts Unassigned first and shows work days, shifts and weekly counts", () => {
    renderWeek();
    const [unassigned, assigned] = within(screen.getByRole("table")).getAllByRole("rowheader");
    expect(unassigned).toHaveAccessibleName("Unassigned Needs a worker 1 jobs this week");
    expect(assigned).toHaveAccessibleName("Ayesha Noor Mon–Fri · 07:00–15:00 5 jobs this week");
    expect(within(assigned).getByText("07:00–15:00")).toHaveAttribute("dir", "ltr");
  });

  it("labels days off and leaves days without jobs blank", () => {
    renderWeek();
    const row = getWorkerRow();
    expect(row.getAllByRole("cell", { name: "Day off" })).toHaveLength(2);
    expect(row.getAllByRole("cell", { name: "" })).toHaveLength(4);
  });

  it("shows three blocks and opens the fourth job from +2 more", () => {
    const { onOpen } = renderWeek();
    const firstCell = within(getWorkerRow().getAllByRole("cell")[0]);
    expect(firstCell.getAllByRole("button")).toHaveLength(4);
    expect(firstCell.getByRole("button", { name: "07:00 Lobby mop" })).toBeVisible();
    expect(firstCell.getByRole("button", { name: "07:30 Desk wipe" })).toBeVisible();
    expect(firstCell.getByRole("button", { name: "08:00 Restock" })).toBeVisible();
    expect(firstCell.queryByText("Floor sweep")).toBeNull();
    expect(firstCell.queryByText("Washroom reset")).toBeNull();

    fireEvent.click(firstCell.getByRole("button", { name: "+2 more" }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(4);
  });

  it("opens the clicked week block", () => {
    const { onOpen } = renderWeek();
    fireEvent.click(getWorkerRow().getByRole("button", { name: /Desk wipe/ }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("shows agenda entries in order with times, areas and first names and opens the clicked entry", () => {
    const { onOpen } = renderWeek();
    const agenda = within(screen.getByRole("region", { name: "Mon 16 Nov" }));
    expect(agenda.getByRole("heading", { name: "Mon 16 Nov" })).toBeVisible();
    expect(agenda.getByText("6 jobs")).toBeVisible();
    const entries = agenda.getAllByRole("button");
    expect(entries).toHaveLength(6);
    expect(entries[0]).toHaveAccessibleName("07:00 09:30 Lobby mop A block Ayesha");
    expect(entries[1]).toHaveAccessibleName(/Desk wipe/);
    expect(entries[2]).toHaveAccessibleName(/Restock/);
    expect(entries[3]).toHaveAccessibleName("08:15 08:30 Entry sweep A block Unassigned");
    expect(entries[4]).toHaveAccessibleName(/Floor sweep/);
    expect(entries[5]).toHaveAccessibleName(/Washroom reset/);
    fireEvent.click(entries[3]);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(6);
  });

  it("renders Urdu labels while keeping record names intact", () => {
    renderWeek("ur");
    const table = within(screen.getByRole("table", { name: "ہفتہ" }));
    expect(table.getByRole("columnheader", { name: /آج/ })).toBeVisible();
    expect(table.getByText("کارکن درکار ہے")).toBeVisible();
    expect(table.getByText("اس ہفتے 5 کام")).toBeVisible();
    expect(table.getAllByRole("cell", { name: "چھٹی کا دن" })).toHaveLength(2);
    expect(table.getByRole("button", { name: "+2 مزید" })).toBeVisible();
    expect(table.getByText("Ayesha Noor")).toBeVisible();
    const agenda = within(screen.getByRole("region", { name: "پیر 16 نومبر" }));
    expect(agenda.getByText("6 کام")).toBeVisible();
    expect(agenda.getByRole("button", { name: /Entry sweep.*کوئی مقرر نہیں/ })).toBeVisible();
  });
});
