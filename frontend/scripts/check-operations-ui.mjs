// Opt-in browser smoke check; set PLAYWRIGHT_MODULE to your installed playwright-core module.
// Uses fabricated API responses, never credentials or live customer data.
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
const output = process.env.UI_SCREENSHOTS || "/tmp/priv-operations-browser";
await mkdir(output, { recursive: true });
const languageNotice = () => "آگے بڑھنے کے لیے انٹرنیٹ ضروری ہے";
const location = { id: 1, name: "Gulberg office", timezone: "Asia/Karachi" };
const counts = {
  pending: 1,
  inProgress: 0,
  completed: 0,
  missed: 0,
  notCompletedInTime: 0,
  cancelled: 0,
  late: 0,
  total: 1,
};
const entry = (id, name, absent) => ({
  localDate: "2026-10-11",
  staff: {
    id,
    name,
    email: `person${id}@example.test`,
    locationId: 1,
    location,
    shiftStart: "08:00",
    shiftEnd: "16:00",
  },
  attendance: absent
    ? null
    : { status: "PRESENT", checkInTime: "2026-10-11T03:00:00Z" },
  attendanceDisplayStatus: absent ? "ABSENT" : "PRESENT",
  attentionCount: 1,
  tasks: [
    {
      id: 10 + id,
      title: "Morning cleaning",
      areaNameSnapshot: "Ground floor washroom",
      status: "PENDING",
      verificationVersion: 2,
      shiftStart: "2026-10-11T03:00:00Z",
      shiftEnd: "2026-10-11T05:00:00Z",
    },
  ],
  taskCounts: counts,
  flags: { isAbsent: absent, isPresent: !absent, hasAttentionTasks: true },
});
const staffStatus = [entry(1, "Ali", false), entry(2, "Ayesha", true)];
const schedule = {
  location,
  weekStart: "2026-10-05",
  weekEndExclusive: "2026-10-12",
  asOf: "2026-10-11T08:00:00Z",
  days: [
    {
      date: "2026-10-11",
      items: [
        {
          key: "actual:99",
          kind: "actual",
          instanceId: 99,
          templateId: 2,
          title: "Afternoon cleaning",
          areaNameSnapshot: "West washroom",
          status: "PENDING",
          staff: null,
          startsAt: "2026-10-11T08:00:00Z",
          endsAt: "2026-10-11T09:00:00Z",
        },
      ],
    },
  ],
};
const review = {
  id: 9,
  state: "MANAGER_REVIEW",
  priority: 2,
  unread: true,
  location,
  area: { id: 1, name: "Ground floor washroom" },
  task: { id: 11, title: "Morning cleaning", staff: { id: 3, name: "Sana" } },
  issues: [],
};
function responseFor(path, mode = "ready") {
  let data = [];
  if (path === "/common/get-current-user")
    data = {
      id: 1,
      name: "Test manager",
      role: mode === "owner" ? "ADMIN" : "MANAGER",
      companyId: 1,
      email: "manager@example.test",
    };
  else if (path === "/subscription")
    data = {
      company: {
        id: 1,
        name: "Test company",
        plan: "PRO",
        subscriptionStatus: "ACTIVE",
        billingSubscriptionId: "demo",
      },
      plan: { limits: {}, features: {} },
      usage: {},
      availablePlans: [],
    };
  else if (path === "/manager/today-status") {
    if (["denied", "failure"].includes(mode))
      return {
        status: mode === "denied" ? 403 : 503,
        body: { success: false, message: "Unavailable" },
      };
    data = {
      date: "2026-10-11",
      asOf: "2026-10-11T08:00:00Z",
      locations: [location],
      staffStatus: mode === "empty" ? [] : staffStatus,
    };
  } else if (path === "/location/1/schedule")
    data = mode === "empty" ? { ...schedule, days: [] } : schedule;
  else if (path === "/location/1/stats")
    data = {
      taskStats: [
        { status: "COMPLETED", _count: { status: 2 } },
        { status: "PENDING", _count: { status: 2 } },
        { status: "CANCELLED", _count: { status: 5 } },
      ],
    };
  else if (path === "/verification-exceptions")
    data = {
      cases: mode === "empty" ? [] : [review],
      total: mode === "empty" ? 0 : 1,
      unreadCount: mode === "empty" ? 0 : 1,
      nextCursor: null,
    };
  return { status: 200, body: { success: true, data } };
}
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (!url.pathname.startsWith("/api/")) return route.continue();
      const { status, body } = responseFor(url.pathname.slice(4));
      return route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    await page.goto(
      process.env.UI_BASE_URL || "http://127.0.0.1:5179/dashboard",
    );
    await page
      .getByRole("heading", { name: "Daily overview", exact: true })
      .waitFor();
    await page.getByText("West washroom", { exact: true }).waitFor();
    await page.evaluate(() => {
      Object.defineProperty(window, "speechSynthesis", {
        value: { getVoices: () => [], cancel() {} },
        configurable: true,
      });
    });
    await page.getByRole("button", { name: "Listen", exact: true }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "Voice is not available." })
      .waitFor();
    if (width === 390) {
      await page.getByText("Show details", { exact: true }).first().click();
      assert.equal(await page.locator("details[open]").count(), 1);
    }
    await page.screenshot({
      path: `${output}/manager-${width}-en.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Not checked in", exact: true })
      .click();
    const work = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Today’s work", exact: true }),
    });
    await work
      .locator("strong:visible")
      .filter({ hasText: /^Ali$/ })
      .waitFor({ state: "hidden" });
    assert.match(await work.innerText(), /Ayesha/);
    assert.doesNotMatch(await work.innerText(), /\bAli\b/);
    await page.getByRole("button", { name: /^Unassigned work/ }).click();
    assert.equal(
      await work
        .getByRole("link", { name: "Assign staff" })
        .getAttribute("href"),
      "/locations/1?tab=templates#schedule-2",
    );
    await page.getByRole("button", { name: "اردو", exact: true }).click();
    await page
      .getByRole("heading", { name: "آج کا خلاصہ", exact: true })
      .waitFor();
    assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
    await page.screenshot({
      path: `${output}/manager-${width}-ur.png`,
      fullPage: true,
    });
    await page.reload();
    await page
      .getByRole("heading", { name: "آج کا خلاصہ", exact: true })
      .waitFor();
    assert.equal(await page.locator("html").getAttribute("lang"), "ur-PK");
    await page.addStyleTag({ content: "html{font-size:32px}" });
    await page.screenshot({
      path: `${output}/manager-${width}-ur-large.png`,
      fullPage: true,
    });
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(
      dimensions.scroll <= dimensions.width + 1,
      `Overflow at ${width}: ${JSON.stringify(dimensions)}`,
    );
    await context.setOffline(true);
    await page
      .getByRole("status")
      .filter({ hasText: languageNotice() })
      .waitFor();
    await context.setOffline(false);
    assert.deepEqual(errors, []);
    console.log(
      `PASS: ${width}px, filters, action links, Urdu persistence/RTL, 200% text, no page errors`,
    );
    await context.close();
  }
  for (const mode of ["owner", "empty", "denied", "failure", "loading"]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.startsWith("/api/")) return route.continue();
      if (mode === "loading" && url.pathname === "/api/manager/today-status")
        await pending;
      const { status, body } = responseFor(url.pathname.slice(4), mode);
      return route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    await page.goto(
      process.env.UI_BASE_URL || "http://127.0.0.1:5179/dashboard",
    );
    if (mode === "loading") {
      await page
        .getByRole("status", { name: "Loading…", exact: true })
        .waitFor();
      release();
      await page.getByText("West washroom", { exact: true }).waitFor();
    } else if (mode === "owner") {
      await page
        .getByRole("heading", { name: "Locations", exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("link", { name: /Gulberg office.*2 staff/ })
          .getAttribute("href"),
        "/today-status?locationId=1",
      );
      await page.getByText("Compare the last 7 days", { exact: true }).click();
      await page
        .getByRole("table")
        .getByText("2 of 4 submitted", { exact: true })
        .first()
        .waitFor();
      assert.equal(
        await page
          .getByRole("table")
          .getByText("2 of 4 submitted", { exact: true })
          .count(),
        2,
      );
    } else if (mode === "empty") {
      await page
        .getByRole("heading", { name: "No staff yet", exact: true })
        .waitFor();
      assert.match(
        await page.locator("body").innerText(),
        /Add staff to a location/,
      );
    } else {
      await page
        .getByRole("alert")
        .filter({
          hasText:
            mode === "denied"
              ? "You do not have access"
              : "Today could not load",
        })
        .waitFor();
      assert.equal(
        await page.locator(".daily-metric strong").first().innerText(),
        "—",
      );
    }
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: `${output}/manager-${mode}.png`,
      fullPage: true,
    });
    release();
    await context.close();
    console.log(`PASS: ${mode} state`);
  }
} finally {
  await browser.close();
}
