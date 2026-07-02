import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { validateRuntimeSecurity } from "./runtimeSecurity.js";
const valid = () => ({
  NODE_ENV: "production",
  ACCESS_TOKEN_SECRET: "t3st-access-7c45de0fab89123456789abcdef",
  REFRESH_TOKEN_SECRET: "t3st-refresh-3b9ca8ef0123456789abcdef0",
  ACCESS_TOKEN_EXPIRY: "15m", REFRESH_TOKEN_EXPIRY: "7d", STAFF_REFRESH_TOKEN_EXPIRY: "30d",
  FRONTEND_URL: "https://app.test.invalid", COOKIE_SECURE: "true", COOKIE_SAME_SITE: "lax",
});
describe("production security configuration", () => {
  it("accepts explicit independent keys, durations and exact HTTPS origins", () => {
    expect(() => validateRuntimeSecurity(valid())).not.toThrow();
    expect(() => validateRuntimeSecurity({ ...valid(), FRONTEND_URL: "https://app.test.invalid,https://owner.test.invalid", COOKIE_SAME_SITE: "none" })).not.toThrow();
  });
  it.each(["", "replace_me", "short", "a".repeat(40), "change_me_".repeat(5), " "+valid().ACCESS_TOKEN_SECRET])("rejects missing/weak/placeholder keys without exposing them", secret => {
    expect(() => validateRuntimeSecurity({ ...valid(), ACCESS_TOKEN_SECRET: secret })).toThrow("ACCESS_TOKEN_SECRET");
    try { validateRuntimeSecurity({ ...valid(), ACCESS_TOKEN_SECRET: secret }); }
    catch (error) { if (secret) expect((error as Error).message).not.toContain(secret); }
  });
  it("rejects identical signing keys", () => {
    expect(() => validateRuntimeSecurity({ ...valid(), REFRESH_TOKEN_SECRET: valid().ACCESS_TOKEN_SECRET })).toThrow("REFRESH_TOKEN_SECRET");
  });
  it.each(["", "0m", "-1h", "3600", "15minutes", "15m "])("rejects ambiguous or invalid token duration %j", expiry => {
    expect(() => validateRuntimeSecurity({ ...valid(), ACCESS_TOKEN_EXPIRY: expiry })).toThrow("ACCESS_TOKEN_EXPIRY");
  });
  it.each(["", "http://app.test.invalid", "https://*.test.invalid", "https://app.test.invalid/path", "https://app.test.invalid/", "https://user:pass@app.test.invalid", "https://app.test.invalid#x", "https://localhost", "https://app.test.invalid,"])("rejects non-exact or insecure frontend origin %j", origin => {
    expect(() => validateRuntimeSecurity({ ...valid(), FRONTEND_URL: origin })).toThrow("FRONTEND_URL");
  });
  it.each(["false", "", "tru"])("requires secure cookies %j", secure => {
    expect(() => validateRuntimeSecurity({ ...valid(), COOKIE_SECURE: secure })).toThrow("COOKIE_SECURE");
  });
  it("rejects invalid same-site rather than silently using lax", () => {
    expect(() => validateRuntimeSecurity({ ...valid(), COOKIE_SAME_SITE: "wrong" })).toThrow("COOKIE_SAME_SITE");
  });
  it("preserves local development and tests without production credentials", () => {
    expect(() => validateRuntimeSecurity({ NODE_ENV: "development" })).not.toThrow();
    expect(() => validateRuntimeSecurity({ NODE_ENV: "test" })).not.toThrow();
  });
  it("aborts actual application import before cron/database/listener side effects with unsafe production config", () => {
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", "await import('./src/app.ts')"], {
      cwd: process.cwd(), timeout: 30_000,
      env: { PATH: process.env.PATH, NODE_ENV: "production", DOTENV_CONFIG_PATH: "/dev/null", DOTENV_CONFIG_QUIET: "true" },
      encoding: "utf8",
    });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(1);
    expect(child.stderr).toContain("Unsafe production configuration");
    expect(child.stdout).not.toMatch(/Server is listening|prisma:|cron/i);
  }, 40_000);
});
