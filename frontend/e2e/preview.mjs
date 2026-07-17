import { preview } from 'vite';
import { join } from 'node:path';
if (process.env.HYGENE_E2E_MANAGED !== 'true') throw new Error('Managed E2E preview required');
const origin = new URL(process.env.HYGENE_E2E_WEB_ORIGIN);
await preview({
  configFile: false,
  envDir: false,
  build: { outDir: join(process.env.HYGENE_E2E_RUNTIME_DIR, 'web') },
  preview: { host: '127.0.0.1', port: Number(origin.port), strictPort: true },
});
