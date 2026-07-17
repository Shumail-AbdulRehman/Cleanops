import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const localPlatform = process.env.HYGENE_E2E_LOCAL_PLATFORM === "true";
for (const path of [
  "/platform/companies",
  "/platform/service",
  "/platform/inquiries",
  "/platform/audit",
])
  test(
    "operator browser boundary stays unavailable: " + path,
    async ({ page }) => {
      const calls: string[] = [];
      page.on("request", (request) => {
        const { pathname } = new URL(request.url());
        if (pathname.startsWith("/api/platform/")) {
          calls.push(`${request.method()} ${pathname}`);
        }
      });
      await page.goto(path);
      await expect(
        page.getByRole("heading", {
          name: localPlatform ? "Platform owner sign-in" : "Platform operator sign-in",
        }),
      ).toBeVisible();
      const provider = page.getByRole("button", { name: "Continue with identity provider" });
      if (localPlatform) {
        await expect(page.getByLabel("Platform email")).toBeVisible();
        await expect(provider).toHaveCount(0);
      } else {
        await expect(provider).toBeDisabled();
      }
      expect([...new Set(calls)]).toEqual(localPlatform ? ["GET /api/platform/session"] : []);
    },
  );
test("actual production bootstrap rejects unsafe config before listener/jobs", () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../../backend/dist/app.js", import.meta.url))],
    {
      cwd: process.env.HYGENE_E2E_RUNTIME_DIR!,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: "0",
        COOKIE_SECURE: "false",
      },
      encoding: "utf8",
      timeout: 15000,
    },
  );
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Unsafe production configuration");
  expect(result.stdout).not.toContain("Server is listening");
  expect(result.stderr).not.toContain(process.env.ACCESS_TOKEN_SECRET);
});
