import { build } from "vite";
import { join } from "node:path";
if (process.env.HYGENE_E2E_MANAGED !== "true") {
  throw new Error(
    "Only the isolated E2E runner may build this fixture application",
  );
}
// Do not load a checkout's ignored .env files into the test browser bundle.
await build({
  envDir: false,
  // Keep the running test app independent of ordinary builds in frontend/dist.
  build: { outDir: join(process.env.HYGENE_E2E_RUNTIME_DIR, 'web'), emptyOutDir: true },
});
