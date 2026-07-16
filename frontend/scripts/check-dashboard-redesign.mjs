// Browser QA uses fabricated API fixtures only. No live accounts, evidence or mutations.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright-core"
);
const axePath = process.env.AXE_MODULE;
const AxeBuilder = axePath ? (await import(axePath)).default : null;
const base = process.env.UI_BASE_URL || "http://127.0.0.1:5173";
const output = process.env.UI_SCREENSHOTS || "/tmp/hygene-dashboard-redesign";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const day = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Karachi",
}).format(new Date());
const stamp = (hour) =>
  day + "T" + String(hour).padStart(2, "0") + ":00:00+05:00";
const now = new Date().toISOString();
const sites = ["Blue Area Office", "G-11 Plaza", "F-8 Clinic"].map(
  (name, i) => ({
    id: i + 1,
    name,
    address: [
      "Blue Area, Islamabad",
      "G-11 Markaz, Islamabad",
      "F-8, Islamabad",
    ][i],
    timezone: "Asia/Karachi",
    latitude: "33.6844",
    longitude: "73.0479",
    radiusMeters: 100,
    isActive: true,
    _count: { staff: 4, taskTemplates: 3 },
  }),
);
const names = [
  "Umer Khalid",
  "Bilal Ahmed",
  "Sara Khan",
  "Hassan Ali",
  "Ayesha Raza",
  "Ali Raza",
  "Sana Ahmed",
  "Omar Khan",
  "Fatima Ali",
  "Usman Raza",
  "Hina Khan",
  "Zain Ahmed",
];
const staff = names.map((name, i) => ({
  id: i + 1,
  name,
  email: "staff" + (i + 1) + "@example.test",
  phone: "03000000000",
  companyId: 1,
  locationId: Math.floor(i / 4) + 1,
  shiftStart: stamp(8),
  shiftEnd: stamp(16),
  isActive: true,
  role: "STAFF",
  createdAt: stamp(8),
}));
const views = {
  TOILET: [
    { key: "bowl_seat", instructions: "Show the bowl interior and seat." },
    {
      key: "exterior_base",
      instructions: "Show the exterior and base with nearby surroundings.",
    },
  ],
  SINK: [
    { key: "basin_tap", instructions: "Show the entire basin, drain and tap." },
  ],
  MIRROR: [
    {
      key: "reflective_surface",
      instructions: "Show the entire mirror. Keep people out of reflections.",
    },
  ],
  BIN: [
    {
      key: "opening_interior",
      instructions: "Show the bin opening and interior.",
    },
  ],
  FLOOR: [
    { key: "wide_zone", instructions: "Show the whole configured floor zone." },
  ],
};
const areas = sites.flatMap((site) =>
  ["Washroom A", "Lobby", "Meeting room", "Office floor", "Washroom B"].map(
    (name, i) => ({
      id: site.id * 10 + i,
      locationId: site.id,
      name,
      roomType: i === 0 || i === 4 ? "WASHROOM" : "GENERAL",
      status: "ACTIVE",
      inventoryVersion: 3,
      qrVersion: 1,
      layoutInstructions: "Ground floor",
      activeScheduleCount: 1,
      _count: { exceptions: i === 0 ? 2 : 0, items: 6 },
      items: ["TOILET", "SINK", "MIRROR", "BIN", "FLOOR", "SINK"].map(
        (fixtureType, n) => ({
          id: site.id * 100 + i * 10 + n,
          areaId: site.id * 10 + i,
          stableCode: fixtureType + "-0" + (n + 1),
          displayName:
            {
              TOILET: "Toilet",
              SINK: "Sink",
              MIRROR: "Mirror",
              BIN: "Bin",
              FLOOR: "Floor zone",
            }[fixtureType] +
            " 0" +
            (n + 1),
          fixtureType,
          sequence: n,
          identificationMode: "ORDERED_CONTEXT",
          existingNumber: null,
          positionHint: null,
          status: n === 3 ? "MAINTENANCE" : "ACTIVE",
          rubricKey: fixtureType.toLowerCase(),
          requiredViews: views[fixtureType],
        }),
      ),
    }),
  ),
);
const tasks = sites.flatMap((site) =>
  Array.from({ length: 8 }, (_, i) => ({
    id: site.id * 100 + i,
    title: "Daily cleaning",
    date: stamp(0),
    areaId: site.id * 10 + (i % 5),
    areaNameSnapshot: areas.find((a) => a.id === site.id * 10 + (i % 5)).name,
    location: site,
    locationId: site.id,
    staff: staff[(site.id - 1) * 4 + (i % 4)],
    staffId: staff[(site.id - 1) * 4 + (i % 4)].id,
    templateId: site.id * 100 + i,
    shiftStart: stamp(8 + i),
    shiftEnd: stamp(9 + i),
    status:
      i < 4
        ? "COMPLETED"
        : i === 4
          ? "IN_PROGRESS"
          : i === 5
            ? "NOT_COMPLETED_INTIME"
            : "PENDING",
    rawStatus:
      i < 4
        ? "COMPLETED"
        : i === 4
          ? "IN_PROGRESS"
          : i === 5
            ? "NOT_COMPLETED_INTIME"
            : "PENDING",
    staffSubmittedAt: i < 4 ? stamp(9 + i) : null,
    verificationVersion: 2,
    verificationState:
      i < 2
        ? "VERIFIED"
        : i < 4
          ? "NEEDS_REVIEW"
          : i === 4
            ? "CAPTURING"
            : i === 5
              ? "NEEDS_REVIEW"
              : "NOT_STARTED",
    completionOutcome: i < 2 ? "VERIFIED_COMPLETE" : null,
    carryOver: false,
    verificationException:
      i === 2 || i === 3
        ? { id: site.id * 10 + i, state: "MANAGER_REVIEW" }
        : null,
    assignments: [
      {
        id: site.id * 100 + i,
        isCurrent: i >= 4,
        status: i < 4 ? "COMPLETED" : "ASSIGNED",
        staff: staff[(site.id - 1) * 4 + (i % 4)],
        staffId: staff[(site.id - 1) * 4 + (i % 4)].id,
        assignedAt: stamp(8),
      },
    ],
  })),
);
const templates = tasks.map((task) => ({
  id: task.templateId,
  title: task.title,
  verificationVersion: 2,
  areaId: task.areaId,
  area: { id: task.areaId, name: task.areaNameSnapshot },
  locationId: task.locationId,
  staffId: task.staffId,
  staff: task.staff,
  isActive: true,
  shiftStart: task.shiftStart,
  shiftEnd: task.shiftEnd,
  recurringType: "DAILY",
  effectiveDate: stamp(0),
  setupStatus: "READY",
  inventorySelection: "ALL",
  description: "Scheduled cleaning",
}));
const attendance = staff.map((s, i) => ({
  id: s.id,
  staffId: s.id,
  locationId: s.locationId,
  staff: s,
  location: sites[s.locationId - 1],
  date: stamp(0),
  expectedStart: stamp(8),
  expectedEnd: stamp(16),
  checkInTime: i % 4 === 3 ? null : stamp(8),
  checkOutTime: null,
  status: i % 4 === 3 ? "ABSENT" : i % 4 === 2 ? "LATE" : "CHECKED_IN",
  isLateCheckIn: i % 4 === 2,
  lateMinutes: i % 4 === 2 ? 12 : null,
  checkInImage: null,
  checkOutImage: null,
}));
const reviews = tasks
  .filter((task) => task.verificationException)
  .map((task) => ({
    id: task.verificationException.id,
    kind: "TASK",
    state: "MANAGER_REVIEW",
    rowVersion: 1,
    priority: 1,
    locationId: task.locationId,
    areaId: task.areaId,
    taskInstanceId: task.id,
    task,
    location: task.location,
    area: { id: task.areaId, name: task.areaNameSnapshot },
    firstRaisedAt: now,
    updatedAt: now,
    displayReasonCode: "CANNOT_ASSESS",
    openIssueCount: 1,
    issues: [
      {
        id: task.id,
        state: "MANAGER_REVIEW",
        reasonCode: "CANNOT_ASSESS",
        firstSeenAt: now,
      },
    ],
    allowedActions: [],
    items: [],
    decisions: [],
    events: [],
    attempts: [],
  }));
const managers = [
  {
    id: 2,
    name: "Ali Raza Khan",
    email: "ali@example.test",
    isActive: true,
    createdAt: now,
    locations: [sites[0], sites[1]],
  },
  {
    id: 3,
    name: "Sara Ahmed",
    email: "sara@example.test",
    isActive: true,
    createdAt: now,
    locations: [sites[2]],
  },
];
const plan = {
  code: "PRO",
  name: "Pro",
  description: "For cleaning companies managing multiple teams.",
  limits: { locations: 5, staff: 25, managers: 3 },
  features: {
    managerAccess: true,
    automaticAssignment: true,
    automaticReassignment: true,
    inventoryVerification: true,
  },
  featureLabels: [
    "GPS attendance and selfies",
    "Automatic assignment and reassignment",
  ],
};
const summary = {
  company: {
    id: 1,
    name: "Hygene QA Company",
    plan: "PRO",
    subscriptionStatus: "ACTIVE",
    billingSubscriptionId: "test",
    billingCustomerId: "test",
    planUpdatedAt: now,
  },
  plan,
  usage: { locations: 3, staff: 12, managers: 3 },
  availablePlans: [plan],
};
const results = [];
for (const role of (process.env.UI_ROLES || "ADMIN,MANAGER").split(",")) {
  for (const width of (process.env.UI_WIDTHS || "1440,768,390")
    .split(",")
    .map(Number)) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
    });
    const page = await context.newPage();
    const errors = [];
    let failure = "";
    let delay = 0;
    let empty = false;
    let manyStaff = false;
    let withoutReviews = false;
    let manyHistoryTasks = false;
    let historicalWorker = false;
    const withHistory = (task) =>
      historicalWorker && task.id === 105
        ? {
            ...task,
            staffId: null,
            staff: null,
            assignments: [
              {
                id: 999,
                staffId: 67,
                status: "MISSED",
                isCurrent: false,
                assignedAt: stamp(8),
                staff: { id: 67, name: "Previous worker" },
              },
            ],
          }
        : task;
    const writes = [];
    page.on("pageerror", (e) => {
      errors.push(e.message);
      console.error("PAGE ERROR", e.message);
    });
    const authorizedSites = role === "ADMIN" ? sites : [sites[0]];
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        path = url.pathname.slice(4).replace(/\/$/, ""),
        q = url.searchParams;
      if (!url.pathname.startsWith("/api/")) return route.continue();
      if (path === failure)
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "Unavailable in QA fixture" }),
        });
      if (delay && path === "/manager/operations/overview")
        await new Promise((resolve) => setTimeout(resolve, delay));
      const loc = q.get("locationId") ? Number(q.get("locationId")) : null;
      const selected = authorizedSites.filter((s) => !loc || s.id === loc);
      const scope = {
        locations: authorizedSites,
        selected,
        days: selected.map((s) => ({
          locationId: s.id,
          timezone: s.timezone,
          localDate: day,
        })),
        date: q.get("date") || "today",
        asOf: now,
      };
      const visibleTasks = empty
        ? []
        : tasks
            .filter((t) => selected.some((s) => s.id === t.locationId))
            .map(withHistory)
            .map((t) =>
              withoutReviews && t.id % 100 === 7
                ? { ...t, staff: null, staffId: null }
                : t,
            );
      const visibleStaff = empty
        ? []
        : staff.filter((s) => selected.some((l) => l.id === s.locationId));
      let data = [];
      if (!["GET", "HEAD"].includes(req.method()))
        writes.push({ path, method: req.method(), body: req.postData() });
      if (path === "/common/get-current-user")
        data = {
          id: 1,
          name: role === "ADMIN" ? "Shumail" : "Ali Raza",
          role,
          companyId: 1,
        };
      else if (path === "/subscription")
        data = {
          ...summary,
          usage: { ...summary.usage, locations: authorizedSites.length },
        };
      else if (path === "/location" && req.method() === "GET")
        data = empty ? [] : authorizedSites;
      else if (path === "/location" && req.method() === "POST")
        data = { id: 9, ...req.postDataJSON().data };
      else if (path === "/manager") data = managers;
      else if (path === "/staff")
        data = manyStaff
          ? Array.from({ length: 24 }, (_, i) => ({
              ...staff[0],
              id: 100 + i,
              name: "Worker " + String(24 - i).padStart(3, "0"),
              email: "worker" + i + "@example.test",
            }))
          : visibleStaff;
      else if (path === "/attendance")
        data = attendance.filter((a) =>
          selected.some((l) => l.id === a.locationId),
        );
      else if (path === "/manager/operations/overview") {
        const comparison = selected.map((s) => ({
          location: s,
          present: empty ? 0 : 3,
          scheduled: empty ? 0 : 4,
          tasks: empty ? 0 : 8,
          submitted: empty ? 0 : 4,
          reviews: empty || withoutReviews ? 0 : 2,
        }));
        data = {
          ...scope,
          metrics: {
            present: comparison.reduce((n, r) => n + r.present, 0),
            scheduled: comparison.reduce((n, r) => n + r.scheduled, 0),
            totalStaff: visibleStaff.length,
            totalTasks: visibleTasks.length,
            submitted: visibleTasks.filter((t) => t.staffSubmittedAt).length,
            reviewCount: empty || withoutReviews ? 0 : selected.length * 2,
            verified: empty ? 0 : selected.length * 2,
            accepted: 0,
          },
          chart: {
            submitted: empty ? 0 : selected.length * 4,
            inProgress: empty ? 0 : selected.length,
            notStarted: empty ? 0 : selected.length * 2,
            overdue: empty ? 0 : selected.length,
          },
          comparison,
          tasks: visibleTasks.slice(0, 5),
          attention: empty
            ? []
            : [
                ...reviews
                  .filter(
                    (r) =>
                      !withoutReviews &&
                      selected.some((s) => s.id === r.locationId),
                  )
                  .slice(0, 3)
                  .map((r) => ({
                    key: "review:" + r.id,
                    kind: "review",
                    caseId: r.id,
                    task: r.task,
                    location: r.location,
                    reasonCode: "CANNOT_ASSESS",
                  })),
                ...visibleTasks
                  .filter((t) => t.status === "NOT_COMPLETED_INTIME")
                  .map((t) => ({
                    key: "task:" + t.id,
                    kind: "task",
                    task: t,
                    location: t.location,
                    reasonCode: "OVERDUE",
                  })),
                ...visibleStaff
                  .filter((s) => s.id % 4 === 0)
                  .map((s) => ({
                    key: "staff:" + s.id,
                    kind: "attendance",
                    staff: s,
                    location: sites[s.locationId - 1],
                    reasonCode: "MISSING_CHECKIN",
                  })),
                ...visibleTasks
                  .filter((t) => !t.staffId)
                  .map((t) => ({
                    key: "unassigned:" + t.id,
                    kind: "task",
                    task: t,
                    location: t.location,
                    reasonCode: "UNASSIGNED",
                  })),
              ],
        };
      } else if (
        path === "/manager/operations/tasks" ||
        path === "/manager/operations/staff"
      ) {
        const isTasks = path.endsWith("/tasks");
        let rows = isTasks
          ? visibleTasks
          : visibleStaff.map((s) => ({
              ...s,
              location: sites[s.locationId - 1],
              localDate: day,
              carryOver: false,
              attendance: attendance.find((a) => a.staffId === s.id),
              attendances: [attendance.find((a) => a.staffId === s.id)],
              tasks: visibleTasks.filter((t) => t.staffId === s.id),
              taskCount: visibleTasks.filter((t) => t.staffId === s.id).length,
              submittedCount: visibleTasks.filter(
                (t) => t.staffId === s.id && t.staffSubmittedAt,
              ).length,
            }));
        if (q.get("q"))
          rows = rows.filter((r) =>
            (r.name || r.areaNameSnapshot || "")
              .toLowerCase()
              .includes(q.get("q").toLowerCase()),
          );
        if (q.get("status") === "submitted")
          rows = rows.filter((r) => r.staffSubmittedAt);
        if (q.get("status") === "overdue")
          rows = rows.filter((r) => r.status === "NOT_COMPLETED_INTIME");
        if (q.get("status") === "unassigned")
          rows = rows.filter((r) => !r.staffId);
        if (q.get("attendance") === "absent")
          rows = rows.filter((r) => !r.attendance?.checkInTime);
        const size = Number(q.get("pageSize") || 20),
          total = rows.length,
          totalPages = Math.max(1, Math.ceil(total / size)),
          number = Math.min(Number(q.get("page") || 1), totalPages);
        data = {
          ...scope,
          rows: rows.slice((number - 1) * size, number * size),
          total,
          page: number,
          pageSize: size,
          totalPages,
        };
      } else if (/^\/location\/\d+\/stats$/.test(path)) {
        const id = Number(path.split("/")[2]),
          location = sites.find((s) => s.id === id),
          actual = tasks.filter((t) => t.locationId === id).map(withHistory);
        const historyTasks = manyHistoryTasks
          ? [
              ...Array.from({ length: 25 }, (_, i) => ({
                ...actual[0],
                id: 1000 + i,
                title: "Earlier cleaning " + (i + 1),
              })),
              ...actual,
            ]
          : actual;
        data = {
          locationInfo: {
            ...location,
            staff: staff.filter((s) => s.locationId === id),
            taskTemplates: templates.filter((t) => t.locationId === id),
            taskInstances: historyTasks,
          },
          taskStats: [
            "COMPLETED",
            "IN_PROGRESS",
            "NOT_COMPLETED_INTIME",
            "PENDING",
          ].map((status) => ({
            status,
            _count: {
              status: actual.filter((t) => t.status === status).length,
            },
          })),
        };
      } else if (/^\/location\/\d+\/areas$/.test(path))
        data = areas.filter((a) => a.locationId === Number(path.split("/")[2]));
      else if (/^\/location\/\d+\/schedule$/.test(path)) {
        const id = Number(path.split("/")[2]);
        data = {
          location: sites[id - 1],
          weekStart: day,
          weekEndExclusive: day,
          asOf: now,
          days: Array.from({ length: 7 }, (_, i) => ({
            date: day,
            items: i
              ? []
              : tasks
                  .filter((t) => t.locationId === id)
                  .map((t) => ({
                    ...t,
                    key: "task:" + t.id,
                    kind: "actual",
                    instanceId: t.id,
                    startsAt: t.shiftStart,
                    endsAt: t.shiftEnd,
                    staffMeaning: "actual",
                    continuesFromPreviousDay: false,
                    continuesIntoNextDay: false,
                  })),
          })),
        };
      } else if (/^\/area\/\d+$/.test(path))
        data = {
          ...areas.find((a) => a.id === Number(path.split("/")[2])),
          templates: templates.filter(
            (t) => t.areaId === Number(path.split("/")[2]),
          ),
        };
      else if (/^\/area\/\d+\/qr$/.test(path))
        data = {
          payload: "hygeneops-area-fixture-qa-only",
          version: 1,
          activeSessionCount: 0,
        };
      else if (path.endsWith("/fixture-labels")) data = [];
      else if (path.endsWith("/standards")) data = [];
      else if (path === "/area/migration/templates") data = [];
      else if (/^\/staff\/details\/\d+$/.test(path)) {
        const id = Number(path.split("/").at(-1)),
          s = staff.find((s) => s.id === id) ?? {
            ...staff[0],
            id,
            name: "Worker " + String(124 - id).padStart(3, "0"),
          },
          actual = tasks.filter((t) => t.staffId === id);
        data = {
          ...s,
          location: sites[s.locationId - 1],
          periodLabel: "Selected period",
          taskTemplates: templates.filter((t) => t.staffId === id),
          taskInstances: actual,
          attendances: attendance.filter((a) => a.staffId === id),
          taskStats: {
            totalTemplates: 2,
            completed: 1,
            pending: 1,
            inProgress: 0,
            missed: 0,
            late: 0,
          },
          attendanceStats: { totalRecords: 1, present: 1, absent: 0, late: 0 },
        };
      } else if (path === "/verification-exceptions") {
        const filtered = empty
          ? []
          : reviews.filter(
              (r) =>
                selected.some((s) => s.id === r.locationId) &&
                (!q.get("areaId") || r.areaId === Number(q.get("areaId"))),
            );
        const size = Number(q.get("pageSize") || 20);
        data = {
          cases: filtered.slice(0, size),
          total: filtered.length,
          page: 1,
          pageSize: size,
          totalPages: 1,
          queueCounts: {
            "needs-me": filtered.length,
            staff: 0,
            service: 0,
            resolved: 0,
          },
          locations: authorizedSites,
        };
      } else if (/^\/verification-exceptions\/\d+\/next$/.test(path))
        data = { nextId: null };
      else if (/^\/verification-exceptions\/\d+$/.test(path))
        data =
          reviews.find((r) => r.id === Number(path.split("/")[2])) ||
          reviews[0];
      else if (/^\/task-instance\/\d+$/.test(path))
        data = tasks.find((t) => t.id === Number(path.split("/")[2]));
      else if (/^\/task-instance\/\d+\/verification$/.test(path))
        data = {
          task: tasks.find((t) => t.id === Number(path.split("/")[2])),
          items: [],
          progress: { total: 0, passed: 0, pending: 0, failed: 0 },
        };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ success: true, data, message: "QA fixture" }),
      });
    });
    const routes = [
      ["dashboard", "/dashboard"],
      ["today", "/today-status?tab=tasks"],
      ["locations", "/locations"],
      ["location", "/locations/1"],
      ["location-areas", "/locations/1?tab=areas"],
      ["area-create", "/locations/1/areas/new"],
      ["location-team", "/locations/1?tab=staff"],
      ["location-schedules", "/locations/1?tab=templates"],
      ["location-week", "/locations/1?tab=schedule"],
      ["location-history", "/locations/1?tab=instances"],
      ["room", "/areas/10"],
      ["room-tasks", "/areas/10?tab=tasks"],
      ["room-qr", "/areas/10?tab=qr"],
      ["room-guidance", "/areas/10?tab=standards"],
      ["room-history", "/areas/10?tab=history"],
      ["team", "/staff"],
      ["team-detail", "/staff/1"],
      ["attendance", "/attendance"],
      ["reviews", "/exceptions"],
      ["review-detail", "/exceptions/12"],
      ["billing", "/subscription"],
      ...(role === "ADMIN" ? [["managers", "/managers"]] : []),
    ];
    for (const [name, path] of process.env.UI_ATTENTION_ONLY ||
    process.env.UI_TASK_LINKS_ONLY
      ? []
      : routes) {
      console.log("CHECK", role, width, name);
      await page.goto(base + path);
      try {
        await page
          .locator("#workspace-content h1")
          .first()
          .waitFor({ timeout: 10000 });
      } catch (error) {
        console.error(
          "FAILED PAGE",
          page.url(),
          await page.locator("body").innerText(),
          errors,
        );
        await page.screenshot({
          path: output + "/failed-" + name + ".png",
          fullPage: true,
        });
        throw error;
      }
      await page.waitForTimeout(350);
      if (name === "area-create")
        assert.equal(
          await page
            .getByRole("button", { name: "Save inventory", exact: true })
            .isDisabled(),
          true,
        );
      if (name === "dashboard") {
        await page.locator(".ops-metric").first().waitFor();
        assert.equal(await page.locator(".ops-metric").count(), 4);
        assert.ok(
          (await page.locator(".attention-panel .ops-issue-row").count()) <= 4,
        );
        if (role === "MANAGER")
          assert.equal(
            await page
              .locator('.workspace-sidebar a[href="/managers"]')
              .count(),
            0,
          );
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      assert.equal(
        overflow,
        false,
        role + " " + width + " " + name + " horizontal overflow",
      );
      if (
        [
          "dashboard",
          "today",
          "locations",
          "location",
          "room",
          "reviews",
          "team",
          "billing",
          "managers",
        ].includes(name)
      ) {
        await page.screenshot({
          path:
            output +
            "/" +
            role.toLowerCase() +
            "-" +
            name +
            "-" +
            width +
            ".png",
          fullPage: true,
        });
      }
      if (AxeBuilder && width === 1440 && role === "ADMIN") {
        const audit = await new AxeBuilder({ page })
          .include("#workspace-content")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        results.push({
          page: name,
          violations: audit.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.map((n) => ({
              target: n.target,
              summary: n.failureSummary,
            })),
          })),
        });
        await writeFile(
          output + "/accessibility.json",
          JSON.stringify(results, null, 2),
        );
      }
    }
    // Regression: a mixed attention preview must not send task/attendance issues to reviews.
    console.log("CHECK", role, width, "attention destinations");
    await page.goto(base + "/today-status?date=" + day + "&locationId=1");
    const attention = page.locator(".attention-panel");
    const reviewAction = attention.getByRole("link", {
      name: "View all reviews",
      exact: true,
    });
    await reviewAction.waitFor();
    const reviewUrl = new URL(await reviewAction.getAttribute("href"), base);
    assert.equal(reviewUrl.pathname, "/exceptions");
    assert.equal(reviewUrl.searchParams.get("date"), day);
    assert.equal(reviewUrl.searchParams.get("period"), "date");
    assert.equal(reviewUrl.searchParams.get("locationId"), "1");
    await reviewAction.click();
    await page
      .locator("#workspace-content h1")
      .filter({ hasText: /^Reviews$/ })
      .waitFor();

    withoutReviews = true;
    await page.goto(
      base +
        "/today-status?date=" +
        day +
        "&locationId=1&q=old-search&page=3&taskId=100",
    );
    await attention
      .getByRole("link", { name: "Overdue tasks", exact: true })
      .waitFor();
    assert.equal(
      await attention
        .getByRole("link", { name: "View all reviews", exact: true })
        .count(),
      0,
    );
    assert.equal(await attention.locator(".ops-issue-row").count(), 3);
    for (const [label, tab, filter, value] of [
      ["Overdue tasks", "tasks", "status", "overdue"],
      ["Missing check-ins", "staff", "attendance", "absent"],
      ["Unassigned work", "tasks", "status", "unassigned"],
    ]) {
      await attention.getByRole("link", { name: label, exact: true }).click();
      const target = new URL(page.url());
      assert.equal(target.pathname, "/today-status");
      assert.equal(target.searchParams.get("tab"), tab);
      assert.equal(target.searchParams.get(filter), value);
      assert.equal(target.searchParams.get("date"), day);
      assert.equal(target.searchParams.get("locationId"), "1");
      for (const stale of ["q", "page", "taskId"])
        assert.equal(target.searchParams.has(stale), false);
      await page.waitForFunction(
        () => document.activeElement?.id === "daily-records",
      );
      await page
        .locator(
          width < 640
            ? ".ops-records .record-summary"
            : ".ops-records tbody tr",
        )
        .first()
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
    }
    await page.screenshot({
      path: output + "/" + role.toLowerCase() + "-attention-" + width + ".png",
      fullPage: true,
    });
    withoutReviews = false;
    console.log("CHECK", role, width, "location task links");
    manyHistoryTasks = true;
    await page.goto(base + "/today-status?tab=tasks&locationId=1");
    const openTask = page
      .locator(".ops-records")
      .getByRole("link", { name: "Open task", exact: true })
      .first();
    await openTask.waitFor();
    assert.equal(
      await openTask.getAttribute("href"),
      "/locations/1?tab=instances&taskId=100#location-task-history",
    );
    await openTask.click();
    const selectedHistory = page.getByRole("region", {
      name: "Task history",
      exact: true,
    });
    await page.waitForFunction(
      () => document.activeElement?.id === "location-task-history",
    );
    assert.equal(await selectedHistory.getAttribute("data-task-id"), "100");
    const historyRows = selectedHistory.locator(
      width < 768 ? ".record-summary" : "tbody > tr",
    );
    assert.equal(await historyRows.count(), 1);
    assert.equal(await page.locator("#ops-task-detail").count(), 0);
    assert.equal(
      await selectedHistory
        .getByRole("link", { name: "View task photos", exact: true })
        .first()
        .getAttribute("href"),
      "/verification/100?returnTo=" +
        encodeURIComponent("/locations/1?tab=instances&taskId=100"),
    );
    await page.screenshot({
      path:
        output + "/" + role.toLowerCase() + "-selected-task-" + width + ".png",
      fullPage: true,
    });
    await selectedHistory
      .getByRole("button", { name: "Show all tasks", exact: true })
      .click();
    assert.equal(new URL(page.url()).searchParams.has("taskId"), false);
    await page.waitForFunction(
      (mobile) =>
        document.querySelectorAll(
          mobile
            ? "#location-task-history .record-summary"
            : "#location-task-history tbody > tr",
        ).length === 20,
      width < 768,
    );
    assert.equal(await historyRows.count(), 20);
    await page.goBack();
    await page.waitForFunction(
      () => document.activeElement?.id === "location-task-history",
    );
    assert.equal(await selectedHistory.getAttribute("data-task-id"), "100");
    assert.equal(await historyRows.count(), 1);
    await page.reload();
    await page.waitForFunction(
      () => document.activeElement?.id === "location-task-history",
    );
    assert.equal(await historyRows.count(), 1);

    await page.goto(base + "/dashboard");
    await page
      .locator(".attention-panel")
      .getByRole("link", { name: "Open task", exact: true })
      .first()
      .click();
    await page.waitForFunction(
      () => document.activeElement?.id === "location-task-history",
    );
    assert.equal(await selectedHistory.getAttribute("data-task-id"), "105");
    assert.equal(await historyRows.count(), 1);
    await page.goto(base + "/locations/1?tab=instances&taskId=99999");
    await page
      .getByText("This task is not available for this location and period.", {
        exact: true,
      })
      .waitFor();
    assert.equal(await historyRows.count(), 0);
    manyHistoryTasks = false;
    historicalWorker = true;
    await page.goto(
      base + "/today-status?tab=tasks&locationId=1&status=overdue",
    );
    const todayWorker = page
      .locator(
        width < 768
          ? ".ops-records .record-summary .task-worker"
          : ".ops-records tbody .task-worker",
      )
      .first();
    if (width < 768)
      await page
        .locator(".ops-records .record-summary details > summary")
        .first()
        .click();
    await todayWorker.getByText("Previous worker", { exact: true }).waitFor();
    await todayWorker
      .getByText("Previously assigned · Missed assignment", { exact: true })
      .waitFor();
    await page
      .locator(".ops-records")
      .getByRole("link", { name: "Open task", exact: true })
      .first()
      .click();
    await page.waitForFunction(
      () => document.activeElement?.id === "location-task-history",
    );
    const locationWorker = selectedHistory
      .locator(
        width < 768 ? ".record-summary .task-worker" : "tbody .task-worker",
      )
      .first();
    if (width < 768)
      await selectedHistory
        .locator(".record-summary details > summary")
        .first()
        .click();
    await locationWorker
      .getByText("Previous worker", { exact: true })
      .waitFor();
    await locationWorker
      .getByText("Previously assigned · Missed assignment", { exact: true })
      .waitFor();
    assert.equal(
      await locationWorker.getByText("Current", { exact: true }).count(),
      0,
    );
    await page.screenshot({
      path:
        output +
        "/" +
        role.toLowerCase() +
        "-assignment-consistency-" +
        width +
        ".png",
      fullPage: true,
    });
    historicalWorker = false;
    if (process.env.UI_ATTENTION_ONLY || process.env.UI_TASK_LINKS_ONLY) {
      assert.deepEqual(errors, [], role + " " + width + " page errors");
      console.log(
        "PASS",
        role,
        width,
        "attention destinations and location task navigation, selection beyond first page, history, reload, focus and unavailable task",
      );
      await context.close();
      continue;
    }
    if (width === 1440) {
      manyStaff = true;
      await page.goto(base + "/staff");
      await page.getByRole("button", { name: "Name", exact: true }).click();
      await page
        .locator("tbody tr")
        .first()
        .locator("td")
        .first()
        .getByText("Worker 001", { exact: true })
        .waitFor();
      assert.equal(await page.locator("tbody tr").count(), 20);
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page
        .locator("tbody tr")
        .first()
        .locator("td")
        .first()
        .getByText("Worker 021", { exact: true })
        .waitFor();
      assert.equal(await page.locator("tbody tr").count(), 4);
      manyStaff = false;
    }
    await page.goto(base + "/areas/10");
    await page
      .getByRole("button", { name: "View all fixtures", exact: true })
      .click();
    assert.equal(
      await page.locator(".area-inventory-layout tbody tr").count(),
      6,
    );
    await page.getByRole("button", { name: "Show fewer", exact: true }).click();
    assert.equal(
      await page.locator(".area-inventory-layout tbody tr").count(),
      4,
    );
    await page.goto(base + "/locations");
    await page.getByPlaceholder("Search by name or address").fill("G-11");
    await page.waitForTimeout(150);
    assert.equal(
      await page.locator("tbody tr").count(),
      role === "ADMIN" ? 1 : 0,
    );
    if (role === "ADMIN") {
      await page
        .getByRole("button", { name: "Add location", exact: true })
        .click();
      assert.equal(
        await page
          .locator('[role="dialog"]')
          .evaluate((el) =>
            getComputedStyle(el).getPropertyValue("--primary").trim(),
          ),
        await page
          .locator(".workspace")
          .evaluate((el) =>
            getComputedStyle(el).getPropertyValue("--primary").trim(),
          ),
      );
      if (AxeBuilder && width === 1440) {
        const audit = await new AxeBuilder({ page })
          .include('[role="dialog"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        results.push({
          page: "create-location-dialog",
          violations: audit.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.map((n) => ({
              target: n.target,
              summary: n.failureSummary,
            })),
          })),
        });
      }
      await page.getByLabel("Location Name", { exact: true }).fill("QA site");
      await page.getByLabel("Address", { exact: true }).fill("QA address");
      await page.getByLabel("Latitude", { exact: true }).fill("33.68");
      await page.getByLabel("Longitude", { exact: true }).fill("73.04");
      await page
        .getByRole("button", { name: "Create location", exact: true })
        .click();
      await page
        .getByRole("status")
        .filter({ hasText: "Location created." })
        .waitFor();
      assert.ok(
        writes.some((w) => w.path === "/location" && w.method === "POST"),
      );
    } else {
      await page.goto(base + "/managers");
      await page.waitForURL("**/dashboard");
    }
    await page.goto(base + "/dashboard");
    await page.getByRole("button", { name: "اردو", exact: true }).click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await page.screenshot({
      path: output + "/" + role.toLowerCase() + "-urdu-" + width + ".png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "English", exact: true }).click();
    await page.evaluate(
      () => (document.documentElement.style.fontSize = "200%"),
    );
    await page.waitForTimeout(100);
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      )
    ) {
      console.error(
        "OVERFLOW",
        await page.evaluate(() =>
          Array.from(document.querySelectorAll("body *"))
            .filter(
              (e) =>
                e.getBoundingClientRect().right > innerWidth + 2 &&
                getComputedStyle(e).position !== "fixed",
            )
            .slice(-20)
            .map((e) => ({
              tag: e.tagName,
              class: e.className,
              text: e.textContent.slice(0, 70),
              width: e.getBoundingClientRect().width,
              right: e.getBoundingClientRect().right,
            })),
        ),
      );
      await page.screenshot({
        path: output + "/enlarged-overflow.png",
        fullPage: true,
      });
      throw new Error("200% text overflow");
    }
    await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    if (width === 390) {
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(
        await page
          .locator("#workspace-menu-trigger")
          .evaluate((el) => el === document.activeElement),
        true,
      );
    }
    failure = "/manager/operations/overview";
    await page.reload();
    await page
      .getByRole("alert")
      .filter({ hasText: "Records could not load" })
      .waitFor();
    assert.equal(await page.locator(".ops-metric").count(), 0);
    failure = "";
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.locator(".ops-metric").first().waitFor();
    empty = true;
    await page.reload();
    await page.getByText("No issues right now", { exact: true }).waitFor();
    assert.equal(await page.locator(".ops-metric").count(), 4);
    empty = false;
    delay = 600;
    await page.reload();
    await page.locator(".ops-skeleton").waitFor();
    await page.locator(".ops-metric").first().waitFor();
    delay = 0;
    assert.deepEqual(errors, [], role + " " + width + " page errors");
    console.log(
      "PASS " +
        role +
        " " +
        width +
        ": " +
        routes.length +
        " routes, preview limits, filters, dialog, permissions, RTL, enlarged text, navigation, failure/empty/loading",
    );
    await context.close();
  }
}
await writeFile(
  output + "/accessibility.json",
  JSON.stringify(results, null, 2),
);
await browser.close();
const serious = results.flatMap((r) =>
  r.violations
    .filter((v) => ["serious", "critical"].includes(v.impact))
    .map((v) => ({ page: r.page, ...v })),
);
console.log("Accessibility serious/critical findings: " + serious.length);
if (serious.length) {
  console.log(JSON.stringify(serious, null, 2));
  process.exitCode = 1;
}
