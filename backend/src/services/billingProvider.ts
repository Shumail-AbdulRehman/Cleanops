import { ApiError, type Customer, type Paddle, type Status, type Transaction } from '@paddle/paddle-node-sdk';
import { getPaddleClient } from '../config/paddle.js';
import { operationalLog } from '../utils/operationalLog.js';

export const BILLING_PROVIDER_TIMEOUT_MS = 15_000;
export const BILLING_PROVIDER_MAX_PAGES = 5;
export const BILLING_PROVIDER_PAGE_SIZE = 100;

export type BillingProviderFailureClass = 'REJECTED' | 'RATE_LIMITED' | 'CUSTOMER_EXISTS' | 'UNCERTAIN';
export type BillingProviderFailure = {
    classification: BillingProviderFailureClass;
    providerCode: string | null;
    customerId: string | null;
};

export function classifyBillingProviderError(error: unknown): BillingProviderFailure {
    const uncertain: BillingProviderFailure = { classification: 'UNCERTAIN', providerCode: null, customerId: null };
    // A network Error or a lookalike object cannot prove Paddle rejected a write.
    if (!(error instanceof ApiError)) return uncertain;
    const providerCode = typeof error.code === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(error.code)
        ? error.code : null;
    if (providerCode === 'too_many_requests') return { ...uncertain, classification: 'RATE_LIMITED', providerCode };
    if (providerCode === 'customer_already_exists') {
        const ids = typeof error.detail === 'string'
            ? [...new Set(error.detail.match(/\bctm_[a-z0-9]{26}\b/g) ?? [])] : [];
        return { classification: 'CUSTOMER_EXISTS', providerCode, customerId: ids.length === 1 ? ids[0] : null };
    }
    return { ...uncertain, providerCode, classification: error.type === 'request_error' ? 'REJECTED' : 'UNCERTAIN' };
}

/** Safe to propagate: no raw provider error, detail, payload, stack or cause is copied. */
export class BillingProviderError extends Error implements BillingProviderFailure {
    readonly classification: BillingProviderFailureClass;
    readonly providerCode: string | null;
    readonly customerId: string | null;

    constructor(readonly operation: string, failure: BillingProviderFailure) {
        super(`Billing provider ${operation} failed (${failure.classification})`);
        this.name = 'BillingProviderError';
        this.classification = failure.classification;
        this.providerCode = failure.providerCode;
        this.customerId = failure.customerId;
    }
}

type PageCollection<T> = { hasMore: boolean; next(): Promise<T[]> };
/** hasMore must be checked before treating a search as exhaustive. */
export type BillingProviderList<T> = { data: T[]; hasMore: boolean };
type CustomerListQuery = { email: string; status: Status[] };
type TransactionListQuery = NonNullable<Parameters<Paddle['transactions']['list']>[0]>;

// Keep the SDK's method types, with only the collection surface needed for paging.
export type BillingProviderClient = {
    customers: Pick<Paddle['customers'], 'create'> & {
        list(query: NonNullable<Parameters<Paddle['customers']['list']>[0]>): PageCollection<Customer>;
    };
    prices: Pick<Paddle['prices'], 'get' | 'update'>;
    products: Pick<Paddle['products'], 'get'>;
    transactions: Pick<Paddle['transactions'], 'create' | 'get' | 'update'> & {
        list(query: TransactionListQuery): PageCollection<Transaction>;
    };
    subscriptions: Pick<Paddle['subscriptions'], 'get'>;
    customerPortalSessions: Pick<Paddle['customerPortalSessions'], 'create'>;
};

type Deps = { client?: BillingProviderClient; log?: typeof operationalLog };

export function createBillingProvider(deps: Deps = {}) {
    const client = () => deps.client ?? getPaddleClient();
    const log = deps.log ?? operationalLog;

    async function call<T>(operation: string, invoke: () => Promise<T>): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const deadline = new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('Provider deadline exceeded')), BILLING_PROVIDER_TIMEOUT_MS);
            });
            // The SDK does not accept an AbortSignal. Racing consumes late rejections
            // and discards late results; UNCERTAIN never proves a write did not occur.
            return await Promise.race([deadline, Promise.resolve().then(invoke)]);
        } catch (error) {
            const failure = classifyBillingProviderError(error);
            // Encode the fixed operation in event: the shared logger has no operation field.
            log({ event: `BILLING_PROVIDER_${operation.replaceAll('.', '_').toUpperCase()}_FAILED`,
                errorClass: failure.classification, providerCode: failure.providerCode });
            throw new BillingProviderError(operation, failure);
        } finally {
            if (timer !== undefined) clearTimeout(timer);
        }
    }

    async function list<T>(operation: string, open: () => PageCollection<T>): Promise<BillingProviderList<T>> {
        let collection: PageCollection<T> | undefined;
        const data: T[] = [];
        // Do not use for-await: the SDK automatically fetches every remaining page.
        for (let page = 0; page < BILLING_PROVIDER_MAX_PAGES; page++) {
            const rows = await call(operation, () => {
                collection ??= open();
                return collection.next();
            });
            data.push(...rows);
            if (!collection!.hasMore) return { data, hasMore: false };
        }
        return { data, hasMore: true };
    }

    return {
        customers: {
            create: (...args: Parameters<Paddle['customers']['create']>) =>
                call('customers.create', () => client().customers.create(...args)),
            list: (query: CustomerListQuery) => list('customers.list', () => client().customers.list({
                email: [query.email], status: query.status, perPage: BILLING_PROVIDER_PAGE_SIZE,
            })),
        },
        prices: {
            get: (...args: Parameters<Paddle['prices']['get']>) => call('prices.get', () => client().prices.get(...args)),
            update: (...args: Parameters<Paddle['prices']['update']>) => call('prices.update', () => client().prices.update(...args)),
        },
        products: {
            get: (...args: Parameters<Paddle['products']['get']>) => call('products.get', () => client().products.get(...args)),
        },
        transactions: {
            create: (...args: Parameters<Paddle['transactions']['create']>) =>
                call('transactions.create', () => client().transactions.create(...args)),
            get: (...args: Parameters<Paddle['transactions']['get']>) =>
                call('transactions.get', () => client().transactions.get(...args)),
            list: (query: TransactionListQuery) => list('transactions.list', () => client().transactions.list({
                ...query, perPage: BILLING_PROVIDER_PAGE_SIZE,
            })),
            update: (...args: Parameters<Paddle['transactions']['update']>) =>
                call('transactions.update', () => client().transactions.update(...args)),
        },
        subscriptions: {
            get: (...args: Parameters<Paddle['subscriptions']['get']>) =>
                call('subscriptions.get', () => client().subscriptions.get(...args)),
        },
        customerPortalSessions: {
            create: (...args: Parameters<Paddle['customerPortalSessions']['create']>) =>
                call('customerPortalSessions.create', () => client().customerPortalSessions.create(...args)),
        },
    };
}

export type BillingProvider = ReturnType<typeof createBillingProvider>;
export const billingProvider = createBillingProvider();
