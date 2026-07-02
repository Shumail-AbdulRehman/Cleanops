import "dotenv/config";
import { validateRuntimeSecurity } from "./runtimeSecurity.js";

// Must be app.ts's first dependency: ESM evaluates it before cron/provider/DB
// dependencies, so invalid production configuration cannot start background work.
validateRuntimeSecurity(process.env);
