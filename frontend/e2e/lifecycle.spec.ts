import { ui } from './workspace-helpers';
import { test, expect, fixture, backend, enter, login, sql } from "./fixtures";
test.use({ trace: "off", screenshot: "off", video: "off" });
test("React registration persists an owner and own-password replacement revokes its old session", async ({
  page,
  browser,
}) => {
  await page.goto("/signup");
  await page
    .getByLabel("Your name", { exact: true })
    .fill("E2E registered owner");
  await page
    .getByLabel("Company name", { exact: true })
    .fill("E2E registered company");
  await page
    .getByLabel("Work email", { exact: true })
    .fill("registered-e2e@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  const registered = page.waitForResponse(
    (r) =>
      r.url().endsWith("/manager/manager-signup") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Continue to plans" }).click();
  expect((await registered).status()).toBe(201);
  await expect(page).not.toHaveURL(/signup/);
  expect(
    (
      await sql(
        'SELECT COUNT(*)::int AS n FROM "Manager" m JOIN "Company" c ON c.id=m."companyId" WHERE m.email=$1 AND m.role=\'ADMIN\' AND c.name=$2',
        ["registered-e2e@example.invalid", "E2E registered company"],
      )
    )[0].n,
  ).toBe(1);
  const old = await browser.newContext({
    storageState: await page.context().storageState(),
  });
  try {
    await page.goto("/account/security");
    await page
      .getByLabel("Current password", { exact: true })
      .fill(fixture.password);
    await page
      .getByLabel("New password", { exact: true })
      .fill(fixture.password + "New");
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill(fixture.password + "New");
    await page
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    await expect(page).toHaveURL(/login/);
    expect(
      (
        await old.request.get(backend + "/api/common/get-current-user")
      ).status(),
    ).toBe(401);
    const result = await page.request.post(
      backend + "/api/manager/manager-login",
      {
        data: {
          email: "registered-e2e@example.invalid",
          password: fixture.password + "New",
        },
      },
    );
    expect(result.status()).toBe(200);
  } finally {
    await old.close();
  }
});
test("annotation UI persists an immutable note without changing captured attendance", async ({
  page,
}) => {
  const id = fixture.attendance.recovery;
  const before = await sql(
    'SELECT "checkInTime","checkOutTime",status,"checkInImage" FROM "Attendance" WHERE id=$1',
    [id],
  );
  await enter(page, `/staff/${fixture.staff.recovery.id}`);
  await page.getByRole("tab", { name: ui("Attendance") }).click();
  await page
    .getByRole("button", { name: "Attendance context", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Reason (required)")
    .fill("E2E persisted attendance context");
  await dialog
    .getByRole("button", { name: "Record note", exact: true })
    .click();
  await expect(
    dialog.getByText("Context recorded. Original attendance is unchanged."),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await page.reload();
  await page.getByRole("tab", { name: ui("Attendance") }).click();
  await page
    .getByRole("button", { name: "Attendance context", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(
    page.getByRole("dialog").getByText("E2E persisted attendance context"),
  ).toBeVisible();
  expect(
    await sql(
      'SELECT "checkInTime","checkOutTime",status,"checkInImage" FROM "Attendance" WHERE id=$1',
      [id],
    ),
  ).toEqual(before);
  expect(
    (
      await sql(
        'SELECT COUNT(*)::int AS n FROM "AttendanceAnnotation" WHERE "attendanceId"=$1',
        [id],
      )
    )[0].n,
  ).toBe(1);
});
test("sign out of all devices requires a reason and revokes the live staff refresh", async ({
  page,
  request,
}) => {
  const { id } = fixture.staff.recovery;
  await login(request, "recovery");
  expect((await request.get(backend + "/api/staff/profile/me")).status()).toBe(200);
  await enter(page, `/staff/${id}`);
  const endpoint = `/api/common/security/staff/${id}/sign-out-everywhere`;
  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: "Confirm access change" });
  const reason = dialog.getByLabel("Reason", { exact: true });
  let writes = 0;
  page.on("request", incoming => {
    if (incoming.method() === "POST" && incoming.url().endsWith(endpoint)) writes++;
  });

  await page.getByRole("button", { name: "Staff access", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Action", exact: true })
    .selectOption({ label: "Sign out of all devices" });
  await expect(dialog.getByText("This signs the staff member out on every phone. They sign in again with their phone number and a new code.")).toBeVisible();
  await reason.focus();
  await reason.press("Tab");
  await expect(reason).toHaveAccessibleDescription("Enter a reason.");
  await expect(confirm).toBeDisabled();
  expect(writes).toBe(0);

  const explanation = "E2E sign-out after staff report";
  await reason.fill(`  ${explanation}  `);
  const saved = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith(endpoint));
  await confirm.click();
  const response = await saved;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({ reason: explanation });
  expect((await response.json()).data).toEqual({ signedOut: true });
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Signed out of all devices." })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "E2E staff recovery" })).toBeVisible();
  await expect(page.getByText(/Request failed with status code/i)).toHaveCount(0);
  expect(await sql('SELECT "refreshToken" IS NULL AS revoked FROM "Staff" WHERE id = $1', [id])).toEqual([{ revoked: true }]);
  expect((await request.post(backend + "/api/common/refresh-token")).status()).toBe(401);
});

test("manager UI deactivation releases a site and real edit assigns its replacement", async ({
  page,
  browser,
}) => {
  const old = await browser.newContext();
  try {
    await login(old.request, "oldForeign");
    await enter(page, "/managers", "ownerB");
    const oldRow = page
      .getByRole("row")
      .filter({ hasText: "E2E manager oldForeign" });
    await oldRow.getByRole("button", { name: "Manage access" }).click();
    let dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Reason", { exact: true })
      .fill("E2E manager access handover");
    await dialog.getByRole("button", { name: "Confirm access change" }).click();
    await expect(dialog).not.toBeVisible();
    expect(
      (await old.request.get(backend + "/api/manager/profile/me")).status(),
    ).toBe(403);
    expect(
      await sql(
        'SELECT "managerId" FROM "ManagerLocation" WHERE "managerId"=$1',
        [fixture.users.oldForeign.id],
      ),
    ).toHaveLength(0);
    const next = page
      .getByRole("row")
      .filter({ hasText: "E2E manager newForeign" });
    await next.getByRole("button", { name: "Edit", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByRole("checkbox", { name: "E2E site foreign", exact: true })
      .check();
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).not.toBeVisible();
    expect(
      (
        await sql(
          'SELECT "locationId" FROM "ManagerLocation" WHERE "managerId"=$1',
          [fixture.users.newForeign.id],
        )
      )[0].locationId,
    ).toBe(fixture.site.foreign);
  } finally {
    await old.close();
  }
});
test("competing real refreshes have one winner and a stale response cannot revoke it", async ({
  page,
  browser,
}) => {
  await login(page.request);
  const state = await page.context().storageState();
  const a = await browser.newContext({ storageState: state }),
    b = await browser.newContext({ storageState: state });
  try {
    const results = await Promise.all([
      a.request.post(backend + "/api/common/refresh-token"),
      b.request.post(backend + "/api/common/refresh-token"),
    ]);
    expect(results.map((r) => r.status()).sort()).toEqual([200, 401]);
    const winner = results[0].status() === 200 ? a : b;
    expect(
      (
        await winner.request.post(backend + "/api/common/refresh-token")
      ).status(),
    ).toBe(200);
  } finally {
    await a.close();
    await b.close();
  }
});
test("protected photo DTOs hide private/legacy URLs and deny a foreign reader before storage", async ({
  page,
  browser,
}) => {
  await login(page.request);
  const data = await (
    await page.request.get(
      backend + `/api/staff/details/${fixture.staff.legacy.id}`,
    )
  ).json();
  expect(JSON.stringify(data).includes("res.cloudinary.com")).toBe(false);
  expect(JSON.stringify(data)).toContain("LEGACY_RESTRICTED");
  const foreign = await browser.newContext();
  try {
    await login(foreign.request, "ownerB");
    expect(
      (
        await foreign.request.get(
          backend +
            `/api/attendance/${fixture.attendance.recovery}/photos/check-in`,
        )
      ).status(),
    ).toBe(404);
  } finally {
    await foreign.close();
  }
});

test("registration CTA keeps a durable unpaid account outside operations and permits real sign-in",async({page})=>{
 await page.goto('/signup');await page.getByLabel('Your name',{exact:true}).fill('E2E billing landing owner');await page.getByLabel('Company name',{exact:true}).fill('E2E billing landing company');await page.getByLabel('Work email',{exact:true}).fill('billing-landing@example.invalid');await page.getByLabel('Password',{exact:true}).fill(fixture.password);const response=page.waitForResponse(r=>r.url().endsWith('/manager/manager-signup')&&r.request().method()==='POST');await page.getByRole('button',{name:'Continue to plans'}).click();expect((await response).status()).toBe(201);
 await expect(page).toHaveURL(/subscription\/recovery/);await expect(page.getByRole('heading',{name:'Payments are unavailable right now',exact:true})).toBeVisible();await expect(page.getByTitle('Controlled Paddle card form')).toHaveCount(0);
 for(const path of ['/dashboard','/staff']){await page.goto(path);await expect(page).toHaveURL(/subscription/);await expect(page.getByRole('heading',{name:'Payments are unavailable right now',exact:true})).toBeVisible();await expect(page.getByRole('navigation',{name:'Workspace navigation'})).toHaveCount(0);}
 expect((await page.request.post(backend+'/api/common/logout')).status()).toBe(200);await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill('billing-landing@example.invalid');await page.getByLabel('Password',{exact:true}).fill(fixture.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL(/subscription/);await expect(page.getByRole('heading',{name:'Payments are unavailable right now',exact:true})).toBeVisible();await expect(page.getByRole('navigation',{name:'Workspace navigation'})).toHaveCount(0);
 const rows=await sql('SELECT c."billingCustomerId",c."billingSubscriptionId",c."subscriptionStatus" FROM "Company" c JOIN "Manager" m ON m."companyId"=c.id WHERE m.email=$1',['billing-landing@example.invalid']);expect(rows).toEqual([{billingCustomerId:null,billingSubscriptionId:null,subscriptionStatus:'CANCELLED'}]);
});
