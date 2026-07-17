import { test, expect, fixture, backend, enter, sql } from "./fixtures";
test.use({ trace: "off", screenshot: "off", video: "off" });
test("real review UI separates missing upload/submission/review/verification and persists manager closure", async ({
  page,
}) => {
  await enter(page, `/exceptions/${fixture.review.id}`);
  await expect(page.getByText("No task submission recorded")).toBeVisible();
  await expect(
    page.getByText("Verified completion not recorded"),
  ).toBeVisible();
  await expect(page.getByText("0 of 1 current views received")).toBeVisible();
  await expect(page.getByText("No closure decision recorded")).toBeVisible();
  await expect(
    page
      .getByText(
        /New photo checking is unavailable pending safety qualification/,
      )
      .first(),
  ).toBeVisible();
  const before = await sql(
    'SELECT status,"staffSubmittedAt","completionOutcome" FROM "TaskInstance" WHERE id=$1',
    [fixture.review.taskId],
  );
  await page
    .getByRole("radio", { name: "Resolve review", exact: true })
    .click();
  await page
    .getByLabel("Resolution note", { exact: true })
    .fill("E2E missing evidence investigated without verification");
  await page
    .getByRole("button", { name: "Confirm resolution", exact: true })
    .click();
  await expect(
    page.getByText("Review decision recorded", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Verified completion not recorded"),
  ).toBeVisible();
  expect(
    await sql(
      'SELECT status,"staffSubmittedAt","completionOutcome" FROM "TaskInstance" WHERE id=$1',
      [fixture.review.taskId],
    ),
  ).toEqual(before);
  expect(
    (
      await sql('SELECT state FROM "VerificationException" WHERE id=$1', [
        fixture.review.id,
      ])
    )[0].state,
  ).toBe("RESOLVED");
  await page.reload();
  await expect(
    page.getByRole("region", {name: "Decision recorded"}).getByText("E2E missing evidence investigated without verification"),
  ).toBeVisible();
  await page.goto('/exceptions');
  const queue = page.getByRole('region', { name: 'Review queue', exact: true });
  await expect(queue.getByRole('link', { name: /E2E review room/ })).toHaveCount(0);
  await page.getByRole('tab', { name: /^Reviewed/ }).click();
  await expect(queue.getByRole('link', { name: /E2E review room/ })).toContainText('Resolution recorded');
  await page.reload();
  await expect(page.getByRole('tab', { name: /^Reviewed/ })).toHaveAttribute('aria-selected', 'true');
  await expect(queue.getByRole('link', { name: /E2E review room/ })).toContainText('Resolution recorded');
  await queue.getByRole('link', { name: /E2E review room/ }).click();
  await expect(page.getByRole('region', { name: 'Decision recorded', exact: true })).toContainText('E2E missing evidence investigated without verification');
});
test("real task QR is task-bound while retired review extensions remain denied", async ({
  page,
}) => {
  await enter(page, "/exceptions");
  const qr = await page.request.get(
    backend + `/api/task-instance/${fixture.review.taskId}/qr`,
  );
  expect(qr.status()).toBe(200);
  const body = await qr.json();
  expect(typeof body.data.payload).toBe("string");
  const response = await page.request.post(
    backend + `/api/verification-exceptions/${fixture.review.id}/actions`,
    {
      data: {
        requestId: crypto.randomUUID(),
        expectedVersion: 0,
        action: "EXTEND_WINDOW",
        reasonCode: "MISSING_EVIDENCE",
        note: "Retired control remains unavailable",
      },
    },
  );
  expect(response.status()).toBe(410);
});
