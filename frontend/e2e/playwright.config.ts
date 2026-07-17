import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import shared from '../playwright.config';

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const servers = Array.isArray(shared.webServer) ? shared.webServer : [];
export default defineConfig({
  ...shared,
  testDir: fileURLToPath(new URL('./', import.meta.url)),
  outputDir: fileURLToPath(new URL('./.artifacts/failures', import.meta.url)),
  reporter: [['list'], ['json', { outputFile: fileURLToPath(new URL('./.artifacts/results.json', import.meta.url)) }]],
  webServer: [servers[0], {
    ...servers[1],
    command: `${quote(process.execPath)} ${quote(fileURLToPath(new URL('./preview.mjs', import.meta.url)))}`,
    url: process.env.HYGENE_E2E_WEB_ORIGIN! + '/',
  }],
});
