import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { billingProvider } from '../src/services/billingProvider.js';
import { runPaddleSandboxProbe, sandboxProbeGuard } from '../src/services/paddleSandboxProbe.js';

// Run manually with: npx tsx scripts/paddleSandboxProbe.ts --confirm
// No database imports, application startup, card entry or automatic retries.
try {
    const confirm = process.argv.slice(2).includes('--confirm');
    const guard = sandboxProbeGuard(process.env.PADDLE_ENVIRONMENT, confirm);
    if (guard) {
        console.log(JSON.stringify({ ok: false, checks: [{ step: 'guard', status: 'FAIL', code: guard }] }));
        process.exitCode = 1;
    } else {
        const catalog: unknown = JSON.parse(await readFile(new URL('../config/paddle-sandbox-catalog.json', import.meta.url), 'utf8'));
        const priceIds = Array.isArray(catalog) ? catalog.map(entry => entry?.priceId) : [];
        const report = await runPaddleSandboxProbe({
            environment: process.env.PADDLE_ENVIRONMENT, confirm, priceIds, provider: billingProvider,
        });
        console.log(JSON.stringify(report, null, 2));
        if (!report.ok) process.exitCode = 1;
    }
} catch {
    console.log(JSON.stringify({ ok: false, checks: [{ step: 'command', status: 'FAIL', code: 'PROBE_COMMAND_FAILED' }] }));
    process.exitCode = 1;
}
