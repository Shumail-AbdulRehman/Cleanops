import { defineConfig, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_ORIGIN } from './e2e-web/support/env';

// Everything this suite writes lives under the system temp directory, never in the repo.
const workDir = join(tmpdir(), 'hygene-staff-e2e');
const distDir = join(workDir, 'dist');
// The e2e build gets its own temp folder so Metro's cache (default: <tmpdir>/metro-cache) never
// mixes with a normal build's. EXPO_PUBLIC_* values are not part of the cache key (finding 60).
const buildTmpDir = join(workDir, 'tmp');
mkdirSync(buildTmpDir, { recursive: true });

// One free loopback port per run. Workers inherit it through the environment.
if (!process.env.STAFF_E2E_PORT) {
  process.env.STAFF_E2E_PORT = execFileSync(process.execPath, ['-e',
    "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close();});",
  ]).toString().trim();
}
const port = Number(process.env.STAFF_E2E_PORT);
const baseURL = `http://127.0.0.1:${port}`;

// The bundle is built against a reserved test host (e2e-web/support/env.ts). Every request to it is
// answered by fixtures (e2e-web/support/api.ts); anything else that is not loopback is aborted.
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export default defineConfig({
  testDir: './e2e-web',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: join(workDir, 'results'),
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'en-GB',
    timezoneId: 'Asia/Karachi',
    serviceWorkers: 'block',
    launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] },
  },
  projects: [
    { name: 'phone', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
    { name: 'small', use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 700 } } },
  ],
  webServer: {
    command: `npm run build:web -- --clear --output-dir ${quote(distDir)} && ${quote(process.execPath)} e2e-web/serve.mjs ${quote(distDir)} ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: { TMPDIR: buildTmpDir, TMP: buildTmpDir, TEMP: buildTmpDir, EXPO_PUBLIC_API_BASE_URL: `${API_ORIGIN}/api`, DATABASE_URL: 'postgresql://none:none@127.0.0.1:1/none', DOTENV_CONFIG_PATH: '/dev/null' },
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
