import { choose } from './workspace-helpers';
import { test, expect, fixture, backend, enter, login, sql } from "./fixtures";
test.use({ trace: "off", screenshot: "off", video: "off" });

test.afterEach(async ({ page }) => {
  await expect(page.getByText(/Request failed with status code/i)).toHaveCount(0);
});

async function clearStaffEmail(key: string) {
  await sql('UPDATE "Staff" SET email = NULL WHERE id = $1', [fixture.staff[key].id]);
}

async function access(page: import("@playwright/test").Page, key: string) {
  await enter(page, `/staff/${fixture.staff[key].id}`);
  await page
    .getByRole("button", { name: "Staff access", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
test("phone-only staff transfer persists, retains history and hides site-A rows from manager-B", async ({
  page,
  browser,
}) => {
  await clearStaffEmail("transfer");
  await access(page, "transfer");
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Action", exact: true })
    .selectOption("transfer");
  await choose(page, 'Destination site', 'E2E site B', 'en', dialog);
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("E2E reasoned site transfer");
  await dialog.getByRole("button", { name: "Confirm access change" }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "E2E staff transfer" })).toBeVisible();
  await expect(page.getByText("E2E site B", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("No email", { exact: true }).first()).toBeVisible();
  expect(
    (
      await sql('SELECT "locationId" FROM "Staff" WHERE id=$1', [
        fixture.staff.transfer.id,
      ])
    )[0].locationId,
  ).toBe(fixture.site.B);
  expect(
    (
      await sql('SELECT "locationId" FROM "Attendance" WHERE id=$1', [
        fixture.attendance.transfer,
      ])
    )[0].locationId,
  ).toBe(fixture.site.A);
  expect(
    await sql('SELECT id FROM "TaskInstance" WHERE id=$1', [
      fixture.task.transfer,
    ]),
  ).toHaveLength(1);
  const isolated = await browser.newContext();
  try {
    await login(isolated.request, "managerB");
    const response = await isolated.request.get(
      backend + `/api/staff/details/${fixture.staff.transfer.id}`,
    );
    expect(response.status()).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain(
      "E2E history transfer",
    );
    expect(
      (
        await isolated.request.get(
          backend +
            `/api/attendance/${fixture.attendance.transfer}/annotations`,
        )
      ).status(),
    ).toBe(403);
  } finally {
    await isolated.close();
  }
});
test("open-shift transfer conflict retains UI draft and does not change site", async ({
  page,
}) => {
  await access(page, "openShift");
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Action", exact: true })
    .selectOption("transfer");
  await choose(page, 'Destination site', 'E2E site B', 'en', dialog);
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Keep conflict reason");
  await dialog.getByRole("button", { name: "Confirm access change" }).click();
  await expect(dialog.getByRole("alert")).toContainText("a shift is open");
  await expect(dialog.getByLabel("Reason", { exact: true })).toHaveValue(
    "Keep conflict reason",
  );
  expect(
    (
      await sql('SELECT "locationId" FROM "Staff" WHERE id=$1', [
        fixture.staff.openShift.id,
      ])
    )[0].locationId,
  ).toBe(fixture.site.A);
});
for (const action of ["deactivate", "archive"])
  test(`${action} phone-only staff revokes a live session and preserves historical records`, async ({
    page,
    browser,
  }) => {
    const staffContext = await browser.newContext();
    try {
      await login(staffContext.request, action);
      await clearStaffEmail(action);
      expect(
        (
          await staffContext.request.get(backend + "/api/staff/profile/me")
        ).status(),
      ).toBe(200);
      await access(page, action);
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("combobox", { name: "Action", exact: true })
        .selectOption(action);
      await dialog
        .getByLabel("Reason", { exact: true })
        .fill(`E2E ${action} history preservation`);
      await dialog
        .getByRole("button", { name: "Confirm access change" })
        .click();
      await expect(dialog).not.toBeVisible();
      await page.reload();
      await expect(page.getByText("Archived / inactive", { exact: true })).toBeVisible();
      await expect(page.getByText("No email", { exact: true }).first()).toBeVisible();
      expect(
        (
          await sql('SELECT "isActive" FROM "Staff" WHERE id=$1', [
            fixture.staff[action].id,
          ])
        )[0].isActive,
      ).toBe(false);
      expect(
        (
          await staffContext.request.get(backend + "/api/staff/profile/me")
        ).status(),
      ).toBe(403);
      expect(
        await sql('SELECT id FROM "Attendance" WHERE id=$1', [
          fixture.attendance[action],
        ]),
      ).toHaveLength(1);
      expect(
        await sql('SELECT id FROM "TaskInstance" WHERE id=$1', [
          fixture.task[action],
        ]),
      ).toHaveLength(1);
    } finally {
      await staffContext.close();
    }
  });

test("phone-only staff details, overview, schedules, tasks, attendance and location staff table load", async ({ page }) => {
  const { id, phone } = fixture.staff.transfer;
  await clearStaffEmail("transfer");
  await enter(page, `/staff/${id}`);
  await expect(page.getByRole("heading", { name: "E2E staff transfer", exact: true })).toBeVisible();
  await expect(page.getByText(phone, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("No email", { exact: true }).first()).toBeVisible();
  const panel = page.getByRole("tabpanel");
  for (const [tab, content] of [
    ["Overview", "Profile"],
    ["Attendance", "Attendance records"],
    ["Cleaning schedule", "Cleaning schedule"],
    ["Task history", "Task instances"],
  ]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    if (tab === "Cleaning schedule") {
      await expect(panel.getByRole("region", { name: content, exact: true })).toBeVisible();
    } else {
      await expect(panel.getByRole("heading", { name: content, exact: true })).toBeVisible();
    }
    if (tab === "Overview") await expect(panel.getByText("No email", { exact: true })).toBeVisible();
    await expect(page.getByText(/Request failed with status code/i)).toHaveCount(0);
  }
  await page.goto(`/locations/${fixture.site.A}?tab=staff`);
  const row = page.getByRole("row").filter({ hasText: "E2E staff transfer" });
  await expect(row.getByText("No email", { exact: true })).toBeVisible();
});
