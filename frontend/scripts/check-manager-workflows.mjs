// Real React screens with stateful intercepted APIs. No customer credentials/data.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright-core"
);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const base = process.env.UI_BASE_URL || "http://127.0.0.1:5173";
const output = process.env.UI_SCREENSHOTS || "/tmp/priv-manager-implemented";
await mkdir(output, { recursive: true });
const site = { id: 1, name: "Gulberg office", timezone: "Asia/Karachi" };
const now = "2026-10-12T05:42:00Z";
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const task = (id) => ({
  id,
  title: "Morning cleaning",
  areaNameSnapshot: id === 11 ? "Ground floor washroom" : "Washroom " + id,
  location: site,
  locationId: 1,
  staff: { id: 2, name: "Ali Raza" },
  staffId: 2,
  templateId: 1,
  rawStatus: "IN_PROGRESS",
  status: "IN_PROGRESS",
  shiftStart: "2026-10-12T04:00:00Z",
  shiftEnd: "2026-10-12T06:00:00Z",
  verificationDeadline: "2026-10-12T06:30:00Z",
  staffSubmittedAt: null,
  verificationVersion: 2,
  verificationState: "NEEDS_REVIEW",
  completionOutcome: null,
  carryOver: false,
  verificationException: { id: id - 10, state: "MANAGER_REVIEW" },
});
const attempt = {
  id: uuid(3),
  state: "REVIEW_REQUIRED",
  createdAt: "2026-10-12T05:03:00Z",
  receivedAt: "2026-10-12T05:04:00Z",
  mediaAssetId: uuid(4),
  privacyState: "SAFE",
  requirementId: uuid(1),
};
const initialCase = () => ({
  id: 1,
  kind: "TASK",
  state: "MANAGER_REVIEW",
  rowVersion: 3,
  locationId: 1,
  areaId: 1,
  taskInstanceId: 11,
  firstRaisedAt: now,
  updatedAt: now,
  location: site,
  area: { id: 1, name: "Ground floor washroom" },
  task: task(11),
  allowedActions: [
    "ACCEPT_EVIDENCE",
    "REQUEST_RECAPTURE",
    "WAIVE_REQUIREMENT",
    "RESOLVE_ISSUE",
  ],
  issues: [
    {
      id: 1,
      reasonCode: "PHOTO_TOO_DARK",
      state: "MANAGER_REVIEW",
      firstSeenAt: now,
      requirementId: uuid(1),
      latestAttemptId: attempt.id,
      latestAttempt: attempt,
      allowedActions: [
        "ACCEPT_EVIDENCE",
        "REQUEST_RECAPTURE",
        "WAIVE_REQUIREMENT",
      ],
    },
    {
      id: 2,
      reasonCode: "MISSING_EVIDENCE",
      state: "MANAGER_REVIEW",
      firstSeenAt: now,
      allowedActions: [],
      blockedReason:
        "Missing requirements must be satisfied before this issue can close.",
    },
  ],
  items: [
    {
      id: 1,
      nameSnapshot: "Sink 01",
      sourceAreaItemId: 1,
      requirements: [
        {
          id: uuid(1),
          viewKey: "BASIN_DRAIN_TAP",
          instructionsSnapshot: "Show the entire basin, drain and tap.",
          state: "REVIEW_REQUIRED",
          mandatory: true,
          currentAttemptId: attempt.id,
          currentAttempt: attempt,
          allowedActions: [
            "ACCEPT_EVIDENCE",
            "REQUEST_RECAPTURE",
            "WAIVE_REQUIREMENT",
          ],
        },
      ],
    },
    {
      id: 2,
      nameSnapshot: "Sink 02",
      sourceAreaItemId: 2,
      requirements: [
        {
          id: uuid(2),
          viewKey: "BASIN_DRAIN_TAP",
          instructionsSnapshot: "Show the entire basin, drain and tap.",
          state: "MISSING",
          mandatory: true,
          allowedActions: ["REQUEST_RECAPTURE", "WAIVE_REQUIREMENT"],
        },
      ],
    },
  ],
  attempts: [attempt],
  events: [],
  decisions: [],
  standards: [],
});
for (const width of [1440, 390]) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
  });
  const page = await context.newPage();
  let detail = initialCase();
  let reviewIds = Array.from({ length: 47 }, (_, i) => i + 1);
  let conflict = true;
  let photoRequests = 0;
  const requests = [];
  const decisions = [];
  const errors = [];
  let failOverview = false;
  let overviewDelay = 0;
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("PAGE ERROR", e.message);
  });
  page.on("console", (m) => {
    if (m.type() === "error") console.error("BROWSER", m.text());
  });
  await page.route("**/api/**", async (route) => {
    const r = route.request(),
      url = new URL(r.url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const path = url.pathname.slice(4),
      q = url.searchParams;
    requests.push({ path, q: Object.fromEntries(q) });
    if (path === "/manager/operations/overview" && overviewDelay)
      await new Promise((resolve) => setTimeout(resolve, overviewDelay));
    let data = [];
    if (path === "/manager/operations/overview" && failOverview)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Unavailable" }),
      });
    if (path === "/common/get-current-user")
      data = { id: 1, name: "Saad Khan", role: "MANAGER", companyId: 1 };
    else if (path === "/subscription")
      data = {
        company: {
          id: 1,
          plan: "PRO",
          subscriptionStatus: "ACTIVE",
          billingSubscriptionId: "test",
        },
        plan: { limits: {}, features: {} },
        usage: {},
        availablePlans: [],
      };
    else if (path === "/manager/operations/overview")
      data = {
        locations: [site],
        selected: [site],
        days: [
          { locationId: 1, localDate: "2026-10-12", timezone: site.timezone },
        ],
        date: q.get("date") || "today",
        asOf: now,
        metrics: {
          present: 18,
          scheduled: 24,
          totalStaff: 24,
          totalTasks: 24,
          submitted: 14,
          reviewCount: 3,
          verified: 10,
          accepted: 1,
        },
        chart: { submitted: 14, inProgress: 5, notStarted: 3, overdue: 2 },
        attention: [
          {
            key: "staff:2",
            kind: "attendance",
            staff: { id: 2, name: "Ayesha" },
            location: site,
            reasonCode: "MISSING_CHECKIN",
          },
          {
            key: "task:12",
            kind: "task",
            task: {
              ...task(12),
              staff: { id: 3, name: "Bilal" },
              areaNameSnapshot: "Second floor washroom",
            },
            location: site,
            reasonCode: "OVERDUE",
          },
          {
            key: "review:1",
            kind: "review",
            caseId: 1,
            task: task(11),
            location: site,
            reasonCode: "PHOTO_TOO_DARK",
          },
        ],
        tasks: [task(11), task(12)],
        comparison: [],
      };
    else if (path.startsWith("/manager/operations/")) {
      const tab = path.endsWith("/staff") ? "staff" : "tasks";
      let total =
        tab === "staff"
          ? q.get("attendance") === "present"
            ? 18
            : 24
          : q.get("status") === "submitted"
            ? 14
            : 24;
      const pageSize = Number(q.get("pageSize") || 20),
        totalPages = Math.max(1, Math.ceil(total / pageSize)),
        number = Math.min(Number(q.get("page") || 1), totalPages);
      const rows = Array.from(
        { length: Math.min(pageSize, total - (number - 1) * pageSize) },
        (_, i) =>
          tab === "tasks"
            ? task(11 + i + (number - 1) * pageSize)
            : {
                id: i + 2,
                name: i === 0 ? "Ali Raza" : "Worker " + i,
                location: site,
                localDate: "2026-10-12",
                attendance: {
                  status: "CHECKED_IN",
                  expectedStart: "2026-10-12T03:00:00Z",
                  expectedEnd: "2026-10-12T11:00:00Z",
                  checkInTime: "2026-10-12T03:00:00Z",
                  checkOutTime: null,
                },
                carryOver: false,
                submittedCount: 2,
                taskCount: 3,
                tasks: [task(11)],
              },
      );
      data = {
        rows,
        total,
        page: number,
        pageSize,
        totalPages,
        locations: [site],
        selected: [site],
        asOf: now,
        days: [{ localDate: "2026-10-12" }],
      };
    } else if (path === "/verification-exceptions") {
      let ids = [...reviewIds];
      if (q.get("q"))
        ids = ids.filter((id) =>
          ("Washroom " + id).toLowerCase().includes(q.get("q").toLowerCase()),
        );
      if (q.get("period") === "today") ids = ids.slice(0, 3);
      if (q.get("queue") && q.get("queue") !== "needs-me") ids = [];
      const size = Number(q.get("pageSize") || 20),
        total = ids.length,
        totalPages = Math.max(1, Math.ceil(total / size)),
        number = Math.min(Number(q.get("page") || 1), totalPages);
      data = {
        cases: ids.slice((number - 1) * size, number * size).map((id) => ({
          ...initialCase(),
          id,
          task: task(id + 10),
          area: {
            id,
            name: id === 1 ? "Ground floor washroom" : "Washroom " + id,
          },
          displayReasonCode: id % 2 ? "PHOTO_TOO_DARK" : "SERVICE_FAILURE",
          openIssueCount: 2,
        })),
        total,
        page: number,
        pageSize: size,
        totalPages,
        queueCounts: {
          "needs-me": reviewIds.length,
          staff: 2,
          service: 1,
          resolved: 0,
        },
        locations: [site],
        nextCursor: null,
        unreadCount: 1,
      };
    } else if (/\/verification-exceptions\/\d+\/next$/.test(path)) {
      const id = Number(path.split("/")[2]),
        ix = reviewIds.indexOf(id);
      data = { nextId: reviewIds[ix + 1] ?? null };
    } else if (/\/verification-exceptions\/\d+\/read$/.test(path)) data = {};
    else if (/\/verification-exceptions\/\d+\/actions$/.test(path)) {
      const body = r.postDataJSON();
      decisions.push(body);
      if (conflict) {
        conflict = false;
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ message: "Case changed. Refresh." }),
        });
      }
      detail.rowVersion++;
      if (body.action === "ACCEPT_EVIDENCE") {
        detail.issues[0].state = "RESOLVED";
        detail.issues[0].allowedActions = [];
        detail.items[0].requirements[0].state = "MANAGER_ACCEPTED";
        detail.decisions.push({
          id: 1,
          action: body.action,
          reasonCode: body.reasonCode,
          note: body.note,
          createdAt: now,
          actorManager: { name: "Saad Khan" },
        });
      }
      data = { id: 1 };
    } else if (/\/verification-exceptions\/\d+$/.test(path)) {
      const id = Number(path.split("/")[2]);
      data = { ...detail, id };
    } else if (path === "/location/1/stats")
      data = {
        locationInfo: {
          ...site,
          address: "Gulberg, Lahore",
          latitude: "31.52",
          longitude: "74.35",
          radiusMeters: 100,
          isActive: true,
          staff: [],
          taskTemplates: [],
          taskInstances: [11, 12].map((id) => ({
            ...task(id),
            date: "2026-10-12T00:00:00Z",
            assignments: [],
          })),
        },
        taskStats: [],
      };
    else if (path === "/task-instance/11" || path === "/task-instance/12")
      data = task(Number(path.split("/").at(-1)));
    else if (path === "/task-instance/42")
      data = {
        ...task(42),
        verificationState: "CAPTURING",
        verificationException: null,
      };
    else if (path === "/task-instance/42/verification")
      data = {
        task: { ...task(42), verificationState: "CAPTURING" },
        areaId: 1,
        areaName: "Ground floor washroom",
        progress: { total: 2, passed: 0, pending: 1, failed: 0 },
        items: initialCase().items.map((i) => ({
          ...i,
          name: i.nameSnapshot,
          mandatory: true,
          requirements: i.requirements.map((r) => ({
            ...r,
            state: r.currentAttempt ? "PROCESSING" : "MISSING",
            instructions: r.instructionsSnapshot,
          })),
        })),
      };
    else if (path === "/task-instance/42/verification/history")
      data = { attempts: [], nextCursor: null };
    else if (path.startsWith("/evidence/")) {
      photoRequests++;
      return route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#dbe5e4"/><ellipse cx="400" cy="270" rx="230" ry="100" fill="#9dafaf"/><ellipse cx="400" cy="250" rx="180" ry="65" fill="#e9f0ef"/><ellipse cx="400" cy="260" rx="130" ry="40" fill="#a9bbbb"/><path d="M400 215v-65q0-35 40-35" stroke="#6a8586" stroke-width="24" fill="none"/><text x="28" y="465" font-size="18" fill="#3e5958">TEST FIXTURE · NOT CUSTOMER EVIDENCE</text></svg>',
      });
    } else if (path === "/location") data = [site];
    else if (path.endsWith("/areas")) data = [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data }),
    });
  });
  await page.goto(base + "/dashboard");
  await page
    .getByRole("heading", { name: "Today’s work", exact: true })
    .waitFor();
  await page.getByRole("link", { name: /Staff present/ }).waitFor();
  await page.screenshot({
    path: `${output}/overview-${width}.png`,
    fullPage: true,
  });
  for (const [label, expected] of [
    ["Staff present", "attendance=present"],
    ["Tasks due today", "tab=tasks"],
    ["Work submitted", "status=submitted"],
    ["Waiting for review", "period=today"],
  ]) {
    await page.goto(base + "/dashboard");
    await page.locator(".ops-metric").filter({ hasText: label }).click();
    await page.waitForURL((url) => url.search.includes(expected));
    await page
      .getByRole("heading", {
        name: label === "Waiting for review" ? "Reviews" : "Today",
        exact: true,
      })
      .waitFor();
    await page.locator("tbody tr").first().waitFor({ state: "attached" });
  }
  await page.goto(base + "/today-status?tab=tasks");
  await page.getByRole("heading", { name: "Today", exact: true }).waitFor();
  await page.locator("tbody tr").first().waitFor({ state: "attached" });
  await page
    .locator(".ops-records")
    .getByRole("link", { name: "Open task", exact: true })
    .first()
    .click();
  await page.waitForURL(
    "**/locations/1?tab=instances&taskId=11#location-task-history",
  );
  await page.waitForFunction(
    () => document.activeElement?.id === "location-task-history",
  );
  assert.equal(
    await page
      .getByRole("region", { name: "Task history", exact: true })
      .getAttribute("data-task-id"),
    "11",
  );
  assert.equal(
    await page
      .getByRole("link", { name: "View task photos", exact: true })
      .first()
      .getAttribute("href"),
    "/verification/11?returnTo=" +
      encodeURIComponent("/locations/1?tab=instances&taskId=11"),
  );
  await page.goto(base + "/exceptions/1");
  await page
    .getByRole("heading", { name: "All required photos", exact: true })
    .waitFor();
  assert.match(page.url(), /exceptions\/1/);
  await page.goto(base + "/exceptions?queue=needs-me&period=all&page=3");
  await page.getByText("41–47 of 47", { exact: true }).waitFor();
  await page.screenshot({
    path: `${output}/reviews-${width}.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "Review", exact: true }).first().click();
  await page
    .getByRole("heading", { name: "All required photos", exact: true })
    .waitFor();
  await page
    .getByRole("link", { name: "Back to reviews", exact: true })
    .click();
  await page.getByText("41–47 of 47", { exact: true }).waitFor();
  assert.match(page.url(), /page=3/);
  await page.waitForFunction(
    () => !!document.activeElement?.getAttribute("data-review-id"),
  );

  // Resolve/remove all results on the last page and ensure page clamping.
  reviewIds = reviewIds.slice(0, 40);
  await page.reload();
  await page.getByText("21–40 of 40", { exact: true }).waitFor();
  await page.waitForURL((url) => url.searchParams.get("page") === "2");
  await page.getByLabel("Find a review", { exact: true }).fill("Washroom 30");
  await page.getByText("1–1 of 1", { exact: true }).waitFor();
  assert.match(page.url(), /q=Washroom/);
  await page.goto(
    base + "/exceptions/1?returnTo=%2Fexceptions%3Fqueue%3Dneeds-me%26page%3D2",
  );
  await page
    .getByRole("heading", { name: "All required photos", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Photo is too dark", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("link", { name: "View task photos" }).count(),
    0,
  );
  assert.ok(await page.getByText("Sink 02", { exact: true }).isVisible());
  await page
    .getByRole("button", { name: "Enlarge photo", exact: true })
    .first()
    .click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.screenshot({
    path: `${output}/case-${width}.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Accept this photo", exact: true })
    .click();
  await page
    .getByLabel("Why are you taking this action?")
    .selectOption("CLEAN");
  await page
    .getByLabel("What did you check?")
    .fill("Required surfaces were visible.");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      configurable: true,
    });
    window.dispatchEvent(new Event("offline"));
  });
  assert.equal(
    await page
      .getByRole("button", { name: "Save decision", exact: true })
      .isEnabled(),
    false,
  );
  assert.equal(
    await page.getByLabel("What did you check?").inputValue(),
    "Required surfaces were visible.",
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      value: true,
      configurable: true,
    });
    window.dispatchEvent(new Event("online"));
  });
  await page
    .getByRole("button", { name: "Save decision", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Your note is kept" })
    .waitFor();
  assert.equal(
    await page.getByLabel("What did you check?").inputValue(),
    "Required surfaces were visible.",
  );
  await page
    .getByRole("button", { name: "Refresh review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save decision", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Photo accepted." })
    .waitFor();
  assert.equal(decisions[0].requestId, decisions[1].requestId);
  assert.equal(
    await page
      .getByRole("status")
      .filter({ hasText: "1 unresolved issues remain" })
      .count(),
    1,
  );
  assert.equal(detail.state, "MANAGER_REVIEW");
  // A held image may be reviewed only via its authorized path; acceptance remains absent.
  detail = initialCase();
  detail.issues[0].latestAttempt = { ...attempt, privacyState: "HOLD" };
  detail.issues[0].allowedActions = ["REQUEST_RECAPTURE"];
  detail.items[0].requirements[0].currentAttempt = {
    ...attempt,
    privacyState: "HOLD",
  };
  detail.items[0].requirements[0].allowedActions = ["REQUEST_RECAPTURE"];
  await page.goto(base + "/exceptions/1");
  await page
    .getByRole("heading", { name: "Photo is too dark", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Accept this photo", exact: true })
      .count(),
    0,
  );
  // Leave the previous held-photo document so its lazy request cannot race the next assertion.
  await page.goto(base + "/dashboard");
  await page
    .getByRole("heading", { name: "Today’s work", exact: true })
    .waitFor();
  // Unknown privacy must not fetch/render a routine image.
  detail.issues[0].latestAttempt = {
    ...attempt,
    privacyState: "PENDING",
    mediaAssetId: null,
  };
  detail.items[0].requirements[0].currentAttempt = {
    ...attempt,
    privacyState: "PENDING",
    mediaAssetId: null,
  };
  detail.attempts = [];
  const before = photoRequests;
  await page.goto(base + "/exceptions/1");
  await page
    .getByRole("heading", { name: "Photo is too dark", exact: true })
    .waitFor();
  assert.equal(photoRequests, before);
  await page.getByRole("button", { name: "اردو", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dir === "rtl");
  await page
    .getByRole("heading", { name: "تمام ضروری تصاویر", exact: true })
    .waitFor();
  await page.evaluate(() => (document.documentElement.style.fontSize = "32px"));
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({
    path: `${output}/case-${width}-ur-large.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.evaluate(() => (document.documentElement.style.fontSize = "16px"));
  failOverview = true;
  await page.goto(base + "/dashboard");
  await page
    .getByRole("alert")
    .filter({ hasText: "Records could not load" })
    .waitFor();
  assert.equal(
    await page.getByRole("link", { name: /^Staff present/ }).count(),
    0,
  );
  failOverview = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByRole("link", { name: /^Staff present/ }).waitFor();
  // Legacy task-photo URLs must open the authorized case, not the old long list.
  await page.goto(
    base +
      "/verification/11?returnTo=" +
      encodeURIComponent("/today-status?tab=tasks&page=2"),
  );
  await page.waitForURL((url) => url.pathname === "/exceptions/1");
  assert.equal(
    new URL(page.url()).searchParams.get("returnTo"),
    "/today-status?tab=tasks&page=2",
  );
  await page
    .getByRole("heading", { name: "Photo is too dark", exact: true })
    .waitFor();
  assert.equal(
    await page.getByText("Open manager case", { exact: true }).count(),
    0,
  );

  await page.goto(base + "/verification/42");
  await page
    .getByText("1 of 2 required photos received", { exact: true })
    .waitFor();
  const oldHistoryCount = requests.filter(
    (r) => r.path === "/task-instance/42/verification/history",
  ).length;
  assert.equal(oldHistoryCount, 0, "older evidence must load only on demand");
  await page
    .locator(".ops-photo-fixture")
    .filter({ hasText: "Sink 02" })
    .getByRole("button")
    .click();
  await page
    .getByRole("heading", { name: "Sink 02", exact: true, level: 2 })
    .waitFor();
  await page
    .getByText("No photo received for this view", { exact: true })
    .waitFor();
  assert.ok(new URL(page.url()).searchParams.has("view"));
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({
    path: `${output}/task-photos-${width}.png`,
    fullPage: true,
  });
  await page
    .getByText("Previous photos and upload history", { exact: true })
    .click();
  await page.getByText("No uploaded photos yet.", { exact: true }).waitFor();
  assert.equal(
    requests.filter((r) => r.path === "/task-instance/42/verification/history")
      .length,
    1,
  );
  await page.goto(base + "/dashboard");
  await page.getByRole("link", { name: /^Staff present/ }).waitFor();
  if (width === 1440) {
    // Navigate within the SPA: a full reload intentionally clears memory cache.
    // Advance the browser clock so TTL tests do not wait several minutes.
    await page.clock.install();
    const overviewCount = () =>
      requests.filter((r) => r.path === "/manager/operations/overview").length;
    const countBefore = overviewCount();
    await page.getByRole("link", { name: /^Staff present/ }).click();
    await page.getByRole("heading", { name: "Today", exact: true }).waitFor();
    await page.goBack();
    await page.getByRole("link", { name: /^Staff present/ }).waitFor();
    assert.equal(
      overviewCount(),
      countBefore,
      "fresh Overview must reuse its cache",
    );
    assert.equal(await page.locator(".ops-skeleton").count(), 0);

    // Reviews unmounts the overview query; Today also observes it and may poll.
    await page.locator('.workspace-sidebar a[href="/exceptions"]').click();
    await page.getByRole("heading", { name: "Reviews", exact: true }).waitFor();
    await page.clock.fastForward(31000);
    overviewDelay = 500;
    const staleRefresh = page.waitForResponse((r) =>
      r.url().includes("/api/manager/operations/overview"),
    );
    await page.goBack();
    await page.getByRole("link", { name: /^Staff present/ }).waitFor();
    assert.equal(
      await page.locator(".ops-skeleton").count(),
      0,
      "stale refresh must keep the cached dashboard visible",
    );
    await staleRefresh;
    assert.equal(
      overviewCount(),
      countBefore + 1,
      "stale Overview must refresh on return",
    );

    const beforeDate = overviewCount();
    const dateResponse = page.waitForResponse(
      (r) =>
        r.url().includes("/api/manager/operations/overview") &&
        r.url().includes("2026-10-11"),
    );
    await page.locator('input[type="date"]').fill("2026-10-11");
    await dateResponse;
    assert.equal(
      overviewCount(),
      beforeDate + 1,
      "different dates need separate results",
    );
    await page.locator('input[type="date"]').fill("");
    await page.getByRole("link", { name: /^Tasks due today/ }).waitFor();
    assert.equal(
      overviewCount(),
      beforeDate + 1,
      "returning to today's fresh cache must not refetch",
    );

    await page
      .locator(".workspace-sidebar")
      .getByRole("link", { name: /^Reviews/ })
      .click();
    await page.getByRole("heading", { name: "Reviews", exact: true }).waitFor();
    await page.clock.runFor(100);
    await page.clock.fastForward(121000);
    const beforeExpiry = overviewCount();
    const expiryReload = page.waitForResponse((r) =>
      r.url().includes("/api/manager/operations/overview"),
    );
    await page.goBack();
    await page.locator(".ops-skeleton").waitFor();
    await expiryReload;
    assert.equal(
      overviewCount(),
      beforeExpiry + 1,
      "unused cache must expire after two minutes",
    );
    console.log(
      "PASS Overview cache: fresh return, stale refresh, isolated dates, inactive expiry",
    );
    overviewDelay = 0;
  }
  assert.deepEqual(errors, []);
  console.log(
    `PASS ${width}: card destinations, task panel/case ID, 47-row pagination/search/clamp, return filters, complete evidence workspace, conflict/idempotency/partial success, privacy, RTL/200% text`,
  );
  await context.close();
}
await browser.close();
