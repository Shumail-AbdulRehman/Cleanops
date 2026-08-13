import { describe, expect, it } from "vitest";
import {
  buildDayAgenda,
  buildScheduleCoverage,
  buildScheduleDetails,
  buildScheduleList,
  buildStaffWeek,
  getScheduleTimes,
  occursOnDate,
  type ScheduleFilters,
} from "./schedulePageModel";
import type { LocationStaff, TaskTemplate } from "./types";

const monday = "2026-11-23";
const tuesday = "2026-11-24";
const wednesday = "2026-11-25";
const friday = "2026-11-27";
const saturday = "2026-11-28";
const context = { timeZone: "Asia/Karachi", today: tuesday };

function schedule(overrides: Partial<TaskTemplate> = {}): TaskTemplate {
  return {
    id: 1,
    title: "Wipe counters",
    effectiveDate: monday,
    recurringType: "DAILY",
    shiftStart: "2026-11-23T02:00:00Z",
    shiftEnd: "2026-11-23T02:45:00Z",
    ...overrides,
  };
}

function person(id: number, name: string, overrides: Partial<LocationStaff> = {}): LocationStaff {
  return { id, name, email: null, shiftStart: "07:00", shiftEnd: "15:00", isActive: true, ...overrides };
}

const asma = person(2, "Asma Khan", { workDays: ["MON", "TUE", "WED", "THU", "FRI"] });
const zain = person(3, "Zain Ali");
const inactiveWorker = person(4, "Bilal", { isActive: false });

describe("schedule occurrence", () => {
  const dates = ["2026-11-22", monday, tuesday, wednesday, friday, saturday];

  it.each<[string, Partial<TaskTemplate>, string[]]>([
    ["daily", {}, dates.slice(1)],
    ["legacy daily", { recurringType: undefined, repeatDays: [] }, dates.slice(1)],
    ["chosen days", { repeatDays: ["MON", "WED", "FRI"] }, [monday, wednesday, friday]],
    ["once", { recurringType: "ONCE", effectiveDate: `${tuesday}T00:00:00Z` }, [tuesday]],
    ["future start", { effectiveDate: wednesday }, [wednesday, friday, saturday]],
    ["inclusive end", { recurringEndDate: `${wednesday}T00:00:00Z` }, [monday, tuesday, wednesday]],
    ["inactive", { isActive: false }, []],
    ["missing effective date with a local start after midnight", {
      effectiveDate: null, shiftStart: "2026-11-23T20:30:00Z",
    }, [tuesday, wednesday, friday, saturday]],
  ])("projects %s on the expected local dates", (_, overrides, expected) => {
    expect(dates.filter(date => occursOnDate(schedule(overrides), date, context.timeZone))).toEqual(expected);
  });

  it("keeps an overnight Monday job on Monday", () => {
    const overnight = schedule({
      repeatDays: ["MON"], shiftStart: "2026-11-23T18:30:00Z", shiftEnd: "2026-11-23T20:30:00Z",
    });
    expect(occursOnDate(overnight, monday, context.timeZone)).toBe(true);
    expect(occursOnDate(overnight, tuesday, context.timeZone)).toBe(false);
  });
});

describe("schedule times", () => {
  it.each([
    ["45 min", "02:00", "02:45", "07:00", "07:45", 0, 45, false],
    ["1 h", "02:00", "03:00", "07:00", "08:00", 1, 0, false],
    ["1 h 30 min", "02:00", "03:30", "07:00", "08:30", 1, 30, false],
    ["2 h", "18:30", "20:30", "23:30", "01:30", 2, 0, true],
    ["24 h", "02:00", "02:00", "07:00", "07:00", 24, 0, true],
  ])("returns the local times and duration parts for %s", (_, start, end, localStart, localEnd, hours, minutes, overnight) => {
    expect(getScheduleTimes({ shiftStart: `${monday}T${start}:00Z`, shiftEnd: `${monday}T${end}:00Z` }, context.timeZone))
      .toEqual({ start: localStart, end: localEnd, duration: { hours, minutes }, overnight });
  });

  it("keeps a missing shift time and duration empty", () => {
    expect(getScheduleTimes({ shiftStart: null, shiftEnd: "08:30" }, context.timeZone))
      .toEqual({ start: null, end: "08:30", duration: null, overnight: false });
  });
});

describe("schedule coverage", () => {
  it("counts active jobs, on-duty staff and open jobs for each local date", () => {
    const coverage = buildScheduleCoverage([
      schedule({ staffId: asma.id }),
      schedule({ id: 2, repeatDays: ["MON", "WED", "FRI"] }),
      schedule({ id: 3, recurringType: "ONCE", isActive: false }),
    ], [asma, zain, inactiveWorker], context, monday);
    expect(coverage).toEqual([
      { date: monday, weekday: "MON", jobs: 2, staffOn: 2, open: 1, load: 1, isToday: false },
      { date: tuesday, weekday: "TUE", jobs: 1, staffOn: 2, open: 0, load: 0.5, isToday: true },
      { date: wednesday, weekday: "WED", jobs: 2, staffOn: 2, open: 1, load: 1, isToday: false },
      { date: "2026-11-26", weekday: "THU", jobs: 1, staffOn: 2, open: 0, load: 0.5, isToday: false },
      { date: friday, weekday: "FRI", jobs: 2, staffOn: 2, open: 1, load: 1, isToday: false },
      { date: saturday, weekday: "SAT", jobs: 1, staffOn: 1, open: 0, load: 0.5, isToday: false },
      { date: "2026-11-29", weekday: "SUN", jobs: 1, staffOn: 1, open: 0, load: 0.5, isToday: false },
    ]);
  });

  it("keeps load zero in a week without jobs and rolls into the next year", () => {
    const coverage = buildScheduleCoverage([], [zain], context, "2026-12-28");
    expect(coverage).toHaveLength(7);
    expect(coverage.every(day => day.load === 0 && day.open === 0 && day.staffOn === 1)).toBe(true);
    expect(coverage[6]).toMatchObject({ date: "2027-01-03", weekday: "SUN" });
  });
});

describe("schedule list", () => {
  const kitchen = { id: 1, name: "Kitchen" };
  const entrance = { id: 2, name: "Entrance" };
  const staff = [zain, asma];
  const templates = [
    schedule({ id: 1, area: kitchen, staffId: asma.id, repeatDays: ["MON"], setupStatus: "NEEDS_REVIEW" }),
    schedule({ id: 2, area: entrance, staffId: asma.id, repeatDays: ["TUE"], setupStatus: "NEEDS_REVIEW" }),
    schedule({ id: 3, title: "Sweep tiles", area: kitchen, staffId: asma.id, setupStatus: "NEEDS_REVIEW" }),
    schedule({ id: 4, area: kitchen, staffId: zain.id, setupStatus: "NEEDS_REVIEW" }),
    schedule({ id: 5, area: kitchen, staffId: asma.id, isActive: false }),
    schedule({ id: 6, area: entrance, staffId: asma.id, setupStatus: "NEEDS_REVIEW" }),
    schedule({ id: 7, area: kitchen, staffId: asma.id, repeatDays: ["FRI"], setupStatus: "NEEDS_REVIEW" }),
    schedule({ id: 8, title: "Empty bins", recurringType: "ONCE", effectiveDate: friday }),
  ];

  function matchingIds(filters: ScheduleFilters) {
    return buildScheduleList(templates, staff, context, filters).groups.flatMap(group => group.rows.map(row => row.id));
  }

  it.each([
    ["wIpE", [1, 2, 4, 5, 6, 7]],
    ["  KITCHEN ", [1, 3, 4, 5, 7]],
    ["zain", [4]],
    ["unassigned", [8]],
  ])("searches title, area and worker for %s", (search, ids) => {
    expect(matchingIds({ search })).toEqual(ids);
  });

  it("combines all filters and keeps chip counts independent of them", () => {
    const filters: ScheduleFilters = { search: "wipe", staff: asma.id, areaId: kitchen.id, chip: "needsAttention", weekday: "MON" };
    expect(matchingIds(filters)).toEqual([1]);
    expect(buildScheduleList(templates, staff, context, filters).counts).toEqual({ all: 8, needsAttention: 7, inactive: 1 });
    expect(matchingIds({ chip: "inactive" })).toEqual([5]);
    expect(matchingIds({ staff: "unassigned", weekday: "FRI" })).toEqual([8]);
    expect(matchingIds({ staff: "unassigned", weekday: "MON" })).toEqual([]);
  });

  it("groups by area and staff in name order, with the special groups at their required ends", () => {
    const areaGroups = buildScheduleList(templates, staff, context, {}, "area").groups;
    const staffGroups = buildScheduleList(templates, staff, context, {}, "staff").groups;
    expect(areaGroups.map(group => group.labelKey ?? group.label)).toEqual(["Entrance", "Kitchen", "No area"]);
    expect(staffGroups.map(group => group.labelKey ?? group.label)).toEqual(["Unassigned", "Asma Khan", "Zain Ali"]);
    expect(areaGroups.every(group => group.rangeText === null)).toBe(true);
  });

  it("sorts from 06:00 and groups both sides of midnight into Night", () => {
    const starts = ["05:59", "22:00", "21:00", "11:59", "12:00", "17:00", "06:00", "23:30", "16:59"];
    const jobs = starts.map((shiftStart, index) => schedule({ id: index + 1, shiftStart, shiftEnd: "01:30" }));
    const groups = buildScheduleList(jobs, [], context).groups;
    expect(groups.map(({ labelKey, rangeText, rows }) => [labelKey, rangeText, rows.map(row => row.start)])).toEqual([
      ["Morning", "06:00–11:59", ["06:00", "11:59"]],
      ["Afternoon", "12:00–16:59", ["12:00", "16:59"]],
      ["Evening", "17:00–21:59", ["17:00", "21:00"]],
      ["Night", "22:00–05:59", ["22:00", "23:30", "05:59"]],
    ]);
    expect(groups[3].rows[1]).toMatchObject({ overnight: true, duration: { hours: 2, minutes: 0 } });
  });

  it("provides repeat, area, fixture, worker and status facts for each row", () => {
    const template = schedule({
      areaId: kitchen.id, staffId: asma.id, recurringType: "ONCE", effectiveDate: friday,
      inventorySelection: "SUBSET", setupStatus: "NEEDS_REVIEW", isActive: false,
    });
    const [group] = buildScheduleList([template], staff, { ...context, areas: [kitchen] }).groups;
    expect(group.rows[0]).toMatchObject({
      areaId: kitchen.id, areaName: "Kitchen", fixturesChoice: "SUBSET",
      worker: { id: asma.id, name: "Asma Khan", workDays: asma.workDays, shiftText: "07:00–15:00" },
      recurringType: "ONCE", weekdays: ["FRI"], onceDate: friday, futureStartDate: friday,
      inactive: true, needsReview: true, start: "07:00", end: "07:45", duration: { hours: 0, minutes: 45 },
    });
    expect(buildScheduleList([schedule()], [], context).groups[0].rows[0]).toMatchObject({
      fixturesChoice: "ALL", weekdays: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
    });
  });
});

describe("staff week and day agenda", () => {
  const staff = [zain, inactiveWorker, asma];
  const assigned = schedule({ staffId: asma.id, repeatDays: ["MON", "WED", "FRI"] });
  const open = schedule({ id: 2, repeatDays: ["MON"], shiftStart: "23:30", shiftEnd: "01:30" });
  const night = schedule({ id: 3, staffId: asma.id, repeatDays: ["MON"], shiftStart: "04:00", shiftEnd: "05:00" });

  it("orders rows and each cell's jobs, counts occurrences and marks days off", () => {
    const rows = buildStaffWeek([open, night, assigned], staff, context, monday);
    expect(rows.map(row => [row.worker?.name ?? null, row.count])).toEqual([[null, 1], [asma.name, 4], [zain.name, 0]]);
    expect(rows[1].days[0].jobs.map(job => job.id)).toEqual([1, 3]);
    expect(rows[1].days[5]).toEqual({ date: saturday, weekday: "SAT", dayOff: true, jobs: [] });
    expect(rows[2].days[5]).toEqual({ date: saturday, weekday: "SAT", dayOff: false, jobs: [] });
    expect(rows[1].worker).toMatchObject({ workDays: asma.workDays, shiftText: "07:00–15:00" });
  });

  it("omits the Unassigned row when it has no occurrences that week", () => {
    const future = schedule({ id: 4, effectiveDate: "2026-12-01" });
    expect(buildStaffWeek([assigned, future], staff, context, monday).map(row => row.worker?.name)).toEqual([asma.name, zain.name]);
  });

  it("shows the sorted local day's occurrences with their actual assignment", () => {
    const templates = [open, night, assigned, schedule({ id: 4, isActive: false })];
    const agenda = buildDayAgenda(templates, staff, context, monday);
    expect(agenda.map(row => [row.id, row.worker?.name ?? null])).toEqual([[1, asma.name], [2, null], [3, asma.name]]);
    expect(buildDayAgenda(templates, staff, context, tuesday)).toEqual([]);
  });
});

describe("schedule details", () => {
  it("returns the next three Mon/Wed/Fri dates from Tuesday with their times", () => {
    const template = schedule({ staffId: asma.id, repeatDays: ["FRI", "MON", "WED"] });
    const details = buildScheduleDetails(template, [asma], context);
    expect(details.facts).toMatchObject({ weekdays: ["MON", "WED", "FRI"], effectiveDate: monday, worker: { name: asma.name } });
    expect(details.nextDays).toEqual([
      { date: wednesday, weekday: "WED", start: "07:00", end: "07:45" },
      { date: friday, weekday: "FRI", start: "07:00", end: "07:45" },
      { date: "2026-11-30", weekday: "MON", start: "07:00", end: "07:45" },
    ]);
  });

  it.each<[string, Partial<TaskTemplate>, string[]]>([
    ["once today", { recurringType: "ONCE", effectiveDate: tuesday }, [tuesday]],
    ["before a recurrence ends", { recurringEndDate: wednesday }, [tuesday, wednesday]],
    ["inactive", { isActive: false }, []],
    ["60 days ahead", { recurringType: "ONCE", effectiveDate: "2027-01-23" }, ["2027-01-23"]],
    ["beyond 60 days", { effectiveDate: "2027-01-24" }, []],
  ])("returns the available dates for %s", (_, overrides, expected) => {
    expect(buildScheduleDetails(schedule(overrides), [], context).nextDays.map(day => day.date)).toEqual(expected);
  });
});
