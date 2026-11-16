import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Load the real config (it only picks a port and creates a folder; it starts nothing).
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { default: config } = await import(join(root, 'playwright.config.ts'));
const server = config.webServer;
const workDir = join(tmpdir(), 'hygene-staff-e2e');
const text = readFileSync(join(root, 'playwright.config.ts'), 'utf8');

test('e2e build has its own temp folder inside the suite work folder', () => {
  const { TMPDIR, TMP, TEMP } = server.env;
  assert.ok(TMPDIR, 'TMPDIR is set');
  assert.equal(TMP, TMPDIR);
  assert.equal(TEMP, TMPDIR);
  assert.notEqual(resolve(TMPDIR), resolve(tmpdir()));
  assert.ok(resolve(TMPDIR).startsWith(resolve(workDir) + '/'), 'inside workDir');
});

test('e2e build clears the cache and writes to the suite output folder', () => {
  assert.match(server.command, /build:web -- --clear --output-dir /);
  assert.ok(server.command.includes(join(workDir, 'dist')));
});

test('e2e build still targets the fixture host', () => {
  assert.equal(server.env.EXPO_PUBLIC_API_BASE_URL, 'http://api.staff-e2e.test/api');
  assert.match(text, /mkdirSync\(buildTmpDir/);
});
