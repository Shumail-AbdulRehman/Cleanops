import { getPaddleCatalog, requireBillingActivation } from '../config/paddle.js';
import { prisma } from '../prisma/prisma.js';
import type { BillingCatalogEntryDto } from '../types/billingLifecycle.js';
import { ApiError } from '../utils/ApiError.js';
import { operationalLog } from '../utils/operationalLog.js';
import { billingProvider, type BillingProvider } from './billingProvider.js';
import type { VerificationActor } from './verification-v2/authorization.service.js';

export const BILLING_CATALOG_CACHE_MS = 60_000;
export type TrialFreeBillingCatalogEntry = Omit<BillingCatalogEntryDto, 'trialPeriod'>;
export type PublicBillingCatalogEntry = Pick<TrialFreeBillingCatalogEntry, 'plan' | 'interval' | 'amount' | 'currencyCode'>;

export class BillingCatalogError extends ApiError {
    readonly recoveryReason = 'PRICE_NOT_READY' as const;
    constructor(readonly code: 'PRICE_HAS_TRIAL' | 'PRICE_NOT_READY') {
        super(503, 'Billing is unavailable. Please try again later.');
        this.name = 'BillingCatalogError';
    }
}

type Deps = {
    db?: Pick<typeof prisma, 'manager'>;
    provider?: { prices: Pick<BillingProvider['prices'], 'get'>; products: Pick<BillingProvider['products'], 'get'> };
    now?: () => Date;
    log?: typeof operationalLog;
};
type Cache = {
    key: string;
    entries?: TrialFreeBillingCatalogEntry[];
    expiresAt?: number;
    pending?: Promise<TrialFreeBillingCatalogEntry[]>;
};

/** Create once per reader, so callers share successful reads and in-flight work. */
export function createBillingCatalog(deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const provider = deps.provider ?? billingProvider;
    const now = deps.now ?? (() => new Date());
    const log = deps.log ?? operationalLog;
    let cache: Cache | undefined;

    async function readCatalog(): Promise<TrialFreeBillingCatalogEntry[]> {
        let catalog: ReturnType<typeof getPaddleCatalog>;
        try {
            requireBillingActivation();
            catalog = getPaddleCatalog();
        } catch {
            throw new ApiError(503, 'Billing is unavailable. Please try again later.');
        }
        const key = JSON.stringify([process.env.PADDLE_ENVIRONMENT, catalog]);
        // One bounded slot; a configuration change cannot reuse the old result.
        if (cache?.key !== key) cache = { key };
        const current = cache;
        const fail = (code: BillingCatalogError['code']): never => {
            log({ event: 'BILLING_CATALOG_FAILED', errorClass: 'BillingCatalogError', providerCode: code });
            throw new BillingCatalogError(code);
        };
        if (!current.entries || current.expiresAt! <= +now()) {
            current.pending ??= Promise.all(catalog.map(async entry => {
                const price = await provider.prices.get(entry.priceId);
                // Reject even malformed trial metadata; never sanitize it into a sale.
                if (price.trialPeriod != null) fail('PRICE_HAS_TRIAL');
                const product = await provider.products.get(price.productId);
                if (price.id !== entry.priceId || product.id !== price.productId ||
                    price.status !== 'active' || product.status !== 'active' ||
                    price.billingCycle?.interval !== entry.interval || price.billingCycle.frequency !== 1 ||
                    typeof price.unitPrice?.amount !== 'string' || !/^\d+$/.test(price.unitPrice.amount) ||
                    !/^[A-Z]{3}$/.test(price.unitPrice?.currencyCode ?? '')) fail('PRICE_NOT_READY');
                return { ...entry, productId: product.id, amount: price.unitPrice.amount, currencyCode: price.unitPrice.currencyCode };
            })).then(entries => {
                current.entries = entries;
                current.expiresAt = +now() + BILLING_CATALOG_CACHE_MS;
                return entries;
            }).finally(() => { current.pending = undefined; });
            await current.pending;
        }
        // Do not expose cached object references to callers.
        return current.entries!.map(entry => ({ ...entry }));
    }

    async function getBillingCatalog(actor: VerificationActor): Promise<TrialFreeBillingCatalogEntry[]> {
        // Authorization and activation are checked even on a cache hit.
        if (actor.role !== 'ADMIN') throw new ApiError(403, 'Company owner access required');
        const owner = await db.manager.findFirst({
            where: { id: actor.id, companyId: actor.companyId, role: 'ADMIN', isActive: true },
            select: { company: { select: { id: true } } },
        });
        if (!owner || owner.company.id !== actor.companyId) throw new ApiError(403, 'Active company owner required');
        return readCatalog();
    }

    async function getPublicCatalog(): Promise<PublicBillingCatalogEntry[]> {
        try {
            const entries = await readCatalog();
            return entries.map(({ plan, interval, amount, currencyCode }) => ({ plan, interval, amount, currencyCode }));
        } catch {
            // Public failures have one safe response, including provider outages.
            throw new ApiError(503, 'Billing is unavailable. Please try again later.');
        }
    }

    return Object.assign(getBillingCatalog, { getPublicCatalog });
}

// Additive until spec 36 replaces the legacy lifecycle reader.
export const getBillingCatalog = createBillingCatalog();
export const getPublicBillingCatalog = getBillingCatalog.getPublicCatalog;
