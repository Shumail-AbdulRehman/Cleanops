import { test, expect, fixture, backend, enter, login, sql } from "./fixtures";
test.use({ trace: "off", screenshot: "off", video: "off" });
test("owner signs in through React and persisted session survives reload/logout", async ({
  page,
}) => {
  await page.goto("/login");
  await page
    .getByLabel("Email", { exact: true })
    .fill(fixture.users.ownerA.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: /Sign in/i, exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/login/);
  expect(
    (await page.request.get(backend + "/api/common/get-current-user")).status(),
  ).toBe(401);
});
test("real company settings form persists and version conflicts preserve draft", async ({
  page,
}) => {
  await enter(page, "/settings");
  const name = page.getByLabel("Company name", { exact: true });
  await expect(name).toBeVisible();
  await name.fill("E2E renamed through UI");
  await page.getByRole("button", { name: "Save company name" }).click();
  await expect(page.getByText("Company settings saved.")).toBeVisible();
  expect(
    (
      await sql('SELECT name FROM "Company" WHERE id=$1', [fixture.company.A])
    )[0].name,
  ).toBe("E2E renamed through UI");
  await page.reload();
  await expect(name).toHaveValue("E2E renamed through UI");
  await name.fill("Preserved conflict draft");
  await sql(
    'UPDATE "Company" SET "accountVersion"="accountVersion"+1 WHERE id=$1',
    [fixture.company.A],
  );
  await page.getByRole("button", { name: "Save company name" }).click();
  await expect(
    page.getByText(/Company settings changed elsewhere/),
  ).toBeVisible();
  await expect(name).toHaveValue("Preserved conflict draft");
});
test("real setup readiness is read-only and reflects persisted sites", async ({
  page,
}) => {
  await enter(page, "/setup");
  await expect(
    page.getByRole("heading", { name: "Get your company ready" }).first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Setup for location:/ })).toContainText(
    "E2E site A",
  );
  const before = await sql('SELECT COUNT(*)::int AS n FROM "TaskInstance"');
  await page.reload();
  await page.getByRole("button", { name: /^Setup for location:/ }).click();
  await expect(page.getByRole("menuitemradio", { name: "E2E site B", exact: true })).toBeVisible();
  expect(await sql('SELECT COUNT(*)::int AS n FROM "TaskInstance"')).toEqual(
    before,
  );
});
test("tenant manager cannot become owner, operator or read foreign workforce", async ({
  page,
}) => {
  await enter(page, "/dashboard", "managerA");
  expect(
    (await page.request.get(backend + "/api/company/settings")).status(),
  ).toBe(403);
  expect(
    (
      await page.request.get(
        backend + `/api/staff/details/${fixture.staff.foreign.id}`,
      )
    ).status(),
  ).toBe(404);
  expect(
    (await page.request.get(backend + "/api/platform/companies")).status(),
  ).toBe(401);
  await page.goto("/platform/companies");
  await expect(
    page.getByRole("heading", {
      name: process.env.HYGENE_E2E_LOCAL_PLATFORM === "true"
        ? "Platform owner sign-in"
        : "Platform operator sign-in",
    }),
  ).toBeVisible();
});
test("colliding manager/staff numeric IDs do not grant staff-self or attendance access", async ({
  page,
}) => {
  expect(fixture.users.ownerA.id).toBe(fixture.staff.transfer.id);
  await login(page.request);
  expect(
    (await page.request.get(backend + "/api/staff/profile/me")).status(),
  ).toBe(403);
  expect(
    (await page.request.get(backend + "/api/attendance/my")).status(),
  ).toBe(403);
});
test("unconfigured billing retains mirrored facts while checkout remains unavailable", async ({
  page,
}) => {
  await enter(page, "/subscription");
  await expect(
    page.getByRole("heading", { name: "Plan & billing" }),
  ).toBeVisible();
  await expect(page.getByRole('button', {name:'Manage in Paddle'})).toBeDisabled();
  await expect(page.getByText('Provider price unavailable', {exact:true})).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue to checkout" }),
  ).toHaveCount(0);
  await expect(page.getByText("Active", { exact: true }).last()).toBeVisible();
});
test("real recovery request is neutral and does not fabricate delivery", async ({
  page,
}) => {
  const before = await sql('SELECT COUNT(*)::int AS n FROM "CredentialToken"');
  await page.goto("/recover-owner-account");
  await page.getByLabel("Owner email").fill(fixture.users.ownerA.email);
  await page.getByRole("button", { name: "Request recovery link" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Email recovery is unavailable.",
  );
  await expect(page.getByRole("alert")).toContainText(
    "Delivery has not been confirmed.",
  );
  expect(await sql('SELECT COUNT(*)::int AS n FROM "CredentialToken"')).toEqual(
    before,
  );
});

test("suspension revokes operational access while owner billing and security remain reachable", async ({
  page,
  browser,
}) => {
  await login(page.request, "ownerB");
  const staff = await browser.newContext();
  try {
    await login(staff.request, "foreign");
    await sql(
      'UPDATE "Company" SET "operationalStatus"=\'SUSPENDED\' WHERE id=$1',
      [fixture.company.B],
    );
    const operational = await staff.request.get(
      backend + "/api/staff/profile/me",
    );
    expect(operational.status()).toBe(403);
    expect(JSON.stringify(await operational.json())).toContain(
      "ACCOUNT_SUSPENDED",
    );
    expect((await page.request.get(backend + "/api/staff")).status()).toBe(403);
    expect(
      (
        await page.request.get(backend + "/api/common/get-current-user")
      ).status(),
    ).toBe(200);
    await page.goto("/subscription");
    await expect(
      page.getByRole("heading", { name: "Plan & billing" }),
    ).toBeVisible();
    await page.goto("/account/security");
    await expect(
      page.getByLabel("Current password", { exact: true }),
    ).toBeVisible();
  } finally {
    await sql(
      'UPDATE "Company" SET "operationalStatus"=\'ACTIVE\' WHERE id=$1',
      [fixture.company.B],
    );
    await staff.close();
  }
});

test("public enterprise inquiry persists through the real form without creating billing access", async ({
  page,
}) => {
  const before = await sql(
    'SELECT COUNT(*)::int AS n FROM "PaddleSubscription"',
  );
  await page.goto("/pricing");
  await page
    .getByRole("button", { name: /Contact sales/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Your name").fill("Synthetic inquiry owner");
  await dialog.getByLabel("Work email").fill("inquiry-e2e@example.invalid");
  await dialog.getByLabel("Company name").fill("E2E inquiry company");
  await dialog.getByLabel("Number of locations").fill("8");
  await dialog.getByLabel("Team size").fill("80");
  await dialog
    .getByLabel("What does your team need?")
    .fill("Synthetic multi-site testing inquiry");
  await dialog
    .getByRole("button", { name: "Send inquiry", exact: true })
    .click();
  await expect(
    dialog.getByText("Thanks — your inquiry is saved."),
  ).toBeVisible();
  const rows = await sql(
    'SELECT company,locations,staff FROM "EnterpriseInquiry" WHERE email=$1',
    ["inquiry-e2e@example.invalid"],
  );
  expect(rows).toEqual([
    { company: "E2E inquiry company", locations: 8, staff: 80 },
  ]);
  expect(
    await sql('SELECT COUNT(*)::int AS n FROM "PaddleSubscription"'),
  ).toEqual(before);
});
