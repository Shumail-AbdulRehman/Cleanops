import { pathToFileURL } from 'node:url';
import { removePaddleTrials } from '../src/services/paddleTrialRemoval.js';

/** Run from backend: npx tsx scripts/removePaddleTrials.ts [--apply]. Preview is the default. */
export async function main(
    args = process.argv.slice(2),
    run = removePaddleTrials,
    output: (line: string) => void = console.log,
): Promise<number> {
    if (args.length > 1 || args.some(arg => arg !== '--apply')) {
        output('Usage: npx tsx scripts/removePaddleTrials.ts [--apply]');
        return 1;
    }
    const apply = args.includes('--apply');
    output(apply ? 'APPLY: remove sandbox price trials and verify.' : 'DRY RUN: no prices will be changed. Use --apply to remove trials.');
    try {
        const results = await run({ apply });
        for (const result of results) {
            output(`${result.plan}/${result.interval} ${result.priceId}: ${result.status}${result.failure ? ` (${result.failure})` : ''}`);
        }
        return results.some(result => result.status === 'FAILED') ? 1 : 0;
    } catch {
        output('Trial removal could not run. Check sandbox configuration and credentials.');
        return 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await import('dotenv/config');
    process.exitCode = await main();
}
