import { readFileSync } from 'node:fs';
import { billingProvider, type BillingProvider } from './billingProvider.js';
import { getPaddleCatalog, type PaddleCatalogEntry } from '../config/paddle.js';

export type TrialRemovalStatus = 'WOULD_REMOVE' | 'ALREADY_CLEAR' | 'REMOVED' | 'FAILED';
export type TrialRemovalResult = PaddleCatalogEntry & {
    status: TrialRemovalStatus;
    failure: 'READ_FAILED' | 'INVALID_PRICE' | 'VERIFICATION_FAILED' | null;
};
type Deps = { provider?: Pick<BillingProvider, 'prices'>; env?: NodeJS.ProcessEnv };

/** Fixed repository allowlist: environment catalog overrides cannot expand this command's scope. */
export function getTrialRemovalCatalog(): PaddleCatalogEntry[] {
    const catalog = getPaddleCatalog({
        PADDLE_ENVIRONMENT: 'sandbox',
        PADDLE_PRICE_CATALOG_JSON: readFileSync(new URL('../../config/paddle-sandbox-catalog.json', import.meta.url), 'utf8'),
    });
    if (catalog.length !== 6) throw new Error('Expected six sandbox prices');
    return catalog;
}

/** No credentials, database, or provider calls until invoked. Fail closed outside sandbox, even for previews. */
export async function removePaddleTrials(options: { apply?: boolean } = {}, deps: Deps = {}): Promise<TrialRemovalResult[]> {
    if ((deps.env ?? process.env).PADDLE_ENVIRONMENT !== 'sandbox') {
        throw new Error('Trial removal requires PADDLE_ENVIRONMENT=sandbox');
    }
    const provider = deps.provider ?? billingProvider;
    const results: TrialRemovalResult[] = [];
    for (const entry of getTrialRemovalCatalog()) {
        const result: TrialRemovalResult = { ...entry, status: 'FAILED', failure: 'READ_FAILED' };
        results.push(result);
        let price;
        try { price = await provider.prices.get(entry.priceId); } catch { continue; }
        if (price.id !== entry.priceId || !price.billingCycle) {
            result.failure = 'INVALID_PRICE';
            continue;
        }
        result.failure = null;
        if (price.trialPeriod === null) {
            result.status = 'ALREADY_CLEAR';
            continue;
        }
        if (!options.apply) {
            result.status = 'WOULD_REMOVE';
            continue;
        }
        const billingCycle = { interval: price.billingCycle.interval, frequency: price.billingCycle.frequency };
        // The SDK serializes these as trial_period:null and billing_cycle. Never change amount/product.
        try { await provider.prices.update(entry.priceId, { trialPeriod: null, billingCycle }); } catch {
            // A timeout can mean the write succeeded. Only the fresh read establishes its outcome.
        }
        try {
            const verified = await provider.prices.get(entry.priceId);
            if (verified.id === entry.priceId && verified.trialPeriod === null &&
                verified.billingCycle?.interval === billingCycle.interval &&
                verified.billingCycle.frequency === billingCycle.frequency) {
                result.status = 'REMOVED';
            } else result.failure = 'VERIFICATION_FAILED';
        } catch { result.failure = 'VERIFICATION_FAILED'; }
    }
    return results;
}
