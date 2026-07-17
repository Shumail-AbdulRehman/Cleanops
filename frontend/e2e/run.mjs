import { createRequire } from "node:module";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, readdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import net from "node:net";
import { isolatedBootstrap } from "./guard.mjs";
process.umask(0o077);
const root = fileURLToPath(new URL("../../", import.meta.url));
const source = isolatedBootstrap(
  process.env.HYGENE_E2E_DATABASE_URL,
  process.env.NODE_ENV,
);
const require = createRequire(join(root, "backend/package.json"));
const { Client } = require("pg");
const directory = await mkdtemp(join(tmpdir(), "hygene-e2e-"));
const database = "priv_e2e_test_" + randomUUID().replaceAll("-", "");
const target = new URL(source);
target.pathname = "/" + database;
async function port() {
  const socket = net.createServer();
  await new Promise((yes, no) =>
    socket.listen(0, "127.0.0.1", yes).once("error", no),
  );
  const selected = socket.address().port;
  await new Promise((yes) => socket.close(yes));
  return selected;
}
const backendPort = await port(),
  webPort = await port();
const env = {
  PATH: process.env.PATH,
  HOME: directory,
  TMPDIR: directory,
  PLAYWRIGHT_BROWSERS_PATH:
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    join(homedir(), ".cache/ms-playwright"),
  LANG: "C.UTF-8",
  TZ: "UTC",
  NODE_ENV: "test",
  DATABASE_URL: target.href,
  DIRECT_URL: target.href,
  PORT: String(backendPort),
  FRONTEND_URL: `http://127.0.0.1:${webPort}`,
  COOKIE_SECURE: "false",
  COOKIE_SAME_SITE: "lax",
  ACCESS_TOKEN_SECRET: randomBytes(40).toString("hex"),
  REFRESH_TOKEN_SECRET: randomBytes(40).toString("hex"),
  ACCESS_TOKEN_EXPIRY: "15m",
  REFRESH_TOKEN_EXPIRY: "7d",
  STAFF_REFRESH_TOKEN_EXPIRY: "7d",
  VERIFICATION_QR_SECRET: randomBytes(40).toString("hex"),
  VERIFICATION_SLOT_SECRET: randomBytes(40).toString("hex"),
  PADDLE_ENVIRONMENT: "sandbox",
  PADDLE_PRICE_CATALOG_JSON: JSON.stringify([
    {
      plan: "STARTER",
      interval: "month",
      priceId: "pri_00000000000000000000000001",
    },
    { plan: "ADVANCED", interval: "month", priceId: "pri_00000000000000000000000003" },
  ]),
  PADDLE_BILLING_ENABLED: "false",
  // Browser checkout tests intercept the provider; never load private .env tokens.
  VITE_PADDLE_ENVIRONMENT: "sandbox",
  VITE_PADDLE_CLIENT_TOKEN: "test_isolated_browser_fixture",
  HYGENE_E2E_BACKEND_ORIGIN: `http://127.0.0.1:${backendPort}`,
  HYGENE_E2E_WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
  HYGENE_E2E_MANIFEST: join(directory, "fixture.json"),
  HYGENE_E2E_DATABASE_URL: target.href,
  HYGENE_E2E_MANAGED: "true",
  HYGENE_E2E_RUNTIME_DIR: directory,
  VITE_API_BASE_URL: `http://127.0.0.1:${backendPort}/api`,
  ...(process.env.HYGENE_E2E_BROWSER_PATH
    ? { HYGENE_E2E_BROWSER_PATH: process.env.HYGENE_E2E_BROWSER_PATH }
    : {}),
};
if (process.env.HYGENE_E2E_LOCAL_PLATFORM === 'true') {
  const bcrypt = require('bcrypt');
  const email = 'platform-' + randomBytes(6).toString('hex') + '@example.invalid';
  const password = randomBytes(24).toString('base64url');
  const credentialFile = join(directory,'platform-credential.json');
  const ownerFile = join(directory,'platform-owner.json');
  await writeFile(credentialFile,JSON.stringify({email,passwordHash:await bcrypt.hash(password,10)}),{mode:0o600});
  await writeFile(ownerFile,JSON.stringify({email,password}),{mode:0o600});
  Object.assign(env,{NODE_ENV:'development',LOCAL_PLATFORM_LOGIN_ENABLED:'true',LOCAL_PLATFORM_CREDENTIAL_FILE:credentialFile,
    VITE_LOCAL_PLATFORM_LOGIN:'true',HYGENE_E2E_LOCAL_PLATFORM:'true',HYGENE_E2E_PLATFORM_OWNER_FILE:ownerFile});
}
const children = new Set();
async function command(args, cwd, overrides = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...env, ...overrides },
      stdio: "inherit",
    });
    children.add(child);
    child.once("error", reject);
    child.once("exit", (code) => {
      children.delete(child);
      if (code === 0) resolve();
      else
        reject(
          new Error("E2E command failed; inspect the redacted test output"),
        );
    });
  });
}
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    for (const child of children) child.kill(signal);
  });
const admin = new Client({ connectionString: source.href });
let created = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  const db = new Client({ connectionString: target.href });
  await db.connect();
  try {
    const migrations = join(root, "backend/prisma/migrations");
    for (const name of (await readdir(migrations))
      .filter((x) => /^\d/.test(x))
      .sort())
      await db.query(
        await readFile(join(migrations, name, "migration.sql"), "utf8"),
      );
  } finally {
    await db.end();
  }
  await command(
    [
      join(root, "backend/node_modules/tsx/dist/cli.mjs"),
      join(root, "frontend/e2e/seed.mjs"),
    ],
    join(root, "backend"),
  );
  await command(
    [
      join(root, "backend/node_modules/typescript/bin/tsc"),
      "-p",
      "tsconfig.json",
    ],
    join(root, "backend"),
  );
  await command(
    [
      join(root, "frontend/node_modules/typescript/bin/tsc"),
      "-p",
      "e2e/tsconfig.json",
    ],
    join(root, "frontend"),
  );
  await command(
    [join(root, "frontend/node_modules/typescript/bin/tsc"), "-b"],
    join(root, "frontend"),
  );
  await command(
    [join(root, "frontend/e2e/build.mjs")],
    join(root, "frontend"),
    { NODE_ENV: "production" },
  );
  await command(
    [
      join(root, "frontend/node_modules/@playwright/test/cli.js"),
      "test",
      "--config", join(root, "frontend/e2e/playwright.config.ts"),
      ...process.argv.slice(2),
    ],
    join(root, "frontend"),
  );
} finally {
  for (const child of children) child.kill("SIGTERM");
  try {
    if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  } finally {
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
}
