import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright-core"
);
const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const output = "/tmp/priv-review-browser";
await mkdir(output, { recursive: true });
const fixture = {
  id: 9,
  kind: "TASK",
  state: "MANAGER_REVIEW",
  priority: 5,
  rowVersion: 3,
  locationId: 1,
  taskInstanceId: 11,
  location: { id: 1, name: "Gulberg hostel", timezone: "Asia/Karachi" },
  area: { id: 1, name: "Ground floor washroom" },
  task: {
    id: 11,
    title: "Morning cleaning",
    shiftEnd: "2026-10-07T10:00:00Z",
    staff: { id: 2, name: "Ali" },
    status: "IN_PROGRESS",
    verificationState: "NEEDS_REVIEW",
  },
  allowedActions: ["RESOLVE_ISSUE"],
  issues: [
    {
      id: 1,
      reasonCode: "MISSING_EVIDENCE",
      state: "MANAGER_REVIEW",
      allowedActions: ["RESOLVE_ISSUE"],
    },
  ],
  attempts: [],
  events: [],
  decisions: [],
};
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
    });
    const page = await context.newPage();
    let conflict = true;
    const submitted = [];
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", async (route) => {
      const r = route.request();
      const p = new URL(r.url()).pathname;
      if (!p.startsWith("/api/")) return route.continue();
      let data = [];
      let status = 200;
      if (p.endsWith("/common/get-current-user"))
        data = { id: 1, name: "Test manager", role: "MANAGER", companyId: 1 };
      else if (p.endsWith("/subscription"))
        data = {
          company: {
            id: 1,
            plan: "PRO",
            subscriptionStatus: "ACTIVE",
            billingSubscriptionId: "demo",
          },
          plan: { limits: {}, features: {} },
          usage: {},
          availablePlans: [],
        };
      else if (p.endsWith("/verification-exceptions/9")) data = fixture;
      else if (p.endsWith("/verification-exceptions/9/actions")) {
        submitted.push(r.postDataJSON());
        if (conflict) {
          status = 409;
          data = {};
        }
      } else if (p.includes("/verification-exceptions"))
        data = { cases: [], unreadCount: 0 };
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({
          success: status === 200,
          data,
          message: status === 409 ? "Case changed" : undefined,
        }),
      });
    });
    await page.goto("http://127.0.0.1:5179/exceptions/9");
    await page
      .getByRole("heading", { name: "Required photos are missing" })
      .waitFor();
    assert.equal(await page.locator("form").count(), 0);
    assert.equal(
      await page
        .getByRole("button", { name: "Close this issue", exact: true })
        .isVisible(),
      false,
    );
    assert.equal(
      await page
        .getByRole("link", { name: "View task photos" })
        .getAttribute("href"),
      "/verification/11",
    );
    await page.screenshot({
      path: `${output}/missing-${width}-en.png`,
      fullPage: true,
    });
    await page.getByText("Other manager options", { exact: true }).click();
    await page
      .getByRole("button", { name: "Close this issue", exact: true })
      .click();
    await page
      .getByLabel("Why are you taking this action?")
      .selectOption("MISSING_EVIDENCE");
    await page
      .getByLabel("What did you check?")
      .fill("Reviewed required photos with staff.");
    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", {
        value: false,
        configurable: true,
      });
      window.dispatchEvent(new Event("offline"));
    });
    await page
      .getByRole("alert")
      .filter({ hasText: "Internet needed to save a decision" })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Save decision", exact: true })
        .isEnabled(),
      false,
    );
    assert.equal(
      await page.getByLabel("What did you check?").inputValue(),
      "Reviewed required photos with staff.",
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
      "Reviewed required photos with staff.",
    );
    await page
      .getByRole("button", { name: "Refresh review", exact: true })
      .click();
    conflict = false;
    await page
      .getByRole("button", { name: "Save decision", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Decision saved." })
      .waitFor();
    assert.equal(submitted.length, 2);
    assert.equal(submitted[0].expectedVersion, 3);
    assert.equal(submitted[0].action, "RESOLVE_ISSUE");
    assert.equal(submitted[0].requestId, submitted[1].requestId);
    await page.getByRole("button", { name: "اردو", exact: true }).click();
    await page
      .getByRole("heading", { name: "ضروری تصاویر موجود نہیں" })
      .waitFor();
    assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
    await page.evaluate(
      () => (document.documentElement.style.fontSize = "32px"),
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.screenshot({
      path: `${output}/missing-${width}-ur-large.png`,
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "Review page: missing-photo guidance, explicit decision, conflict note preservation, retry idempotency, success, responsive Urdu and enlarged text passed.",
  );
} finally {
  await browser.close();
}
