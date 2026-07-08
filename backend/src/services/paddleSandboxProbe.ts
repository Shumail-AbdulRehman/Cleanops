import { randomUUID } from 'node:crypto';
import { BillingProviderError, type BillingProvider } from './billingProvider.js';

type Provider = Pick<BillingProvider, 'prices' | 'customers' | 'transactions'>;
export type SandboxProbeCheck = {
    step: string;
    status: 'PASS' | 'FAIL' | 'SKIPPED';
    code: string;
    id?: string;
    providerStatus?: string;
    interval?: string | null;
    frequency?: number | null;
    currency?: string | null;
    trial?: boolean;
    customerId?: string | null;
};
export type SandboxProbeReport = { ok: boolean; checks: SandboxProbeCheck[] };

const validId = (value: unknown, prefix: string): value is string =>
    typeof value === 'string' && new RegExp(`^${prefix}_[a-z0-9]{26}$`).test(value);
const statuses = ['active', 'archived', 'draft', 'ready', 'billed', 'paid', 'completed', 'canceled', 'past_due'];
const safeStatus = (value: string) => statuses.includes(value) ? value : 'UNKNOWN';
// Never serialize error messages, arbitrary provider strings, payloads or details.
function failureCode(error: unknown): string {
    if (!(error instanceof BillingProviderError)) return 'UNEXPECTED_ERROR';
    if (error.providerCode === 'customer_already_exists') return 'customer_already_exists';
    if (error.providerCode === 'too_many_requests') return 'too_many_requests';
    return ['REJECTED', 'RATE_LIMITED', 'CUSTOMER_EXISTS', 'UNCERTAIN'].includes(error.classification)
        ? error.classification : 'UNEXPECTED_ERROR';
}

/** Guard before any I/O, including price reads. No database or tenant dependencies. */
export function sandboxProbeGuard(environment: string | undefined, confirm: boolean): string | null {
    if (environment !== 'sandbox') return 'SANDBOX_REQUIRED';
    if (!confirm) return 'CONFIRM_REQUIRED';
    return null;
}

export async function runPaddleSandboxProbe(options: {
    environment: string | undefined;
    confirm: boolean;
    priceIds: readonly string[];
    provider: Provider;
}): Promise<SandboxProbeReport> {
    const checks: SandboxProbeCheck[] = [];
    const add = (step: string, status: SandboxProbeCheck['status'], code: string,
        facts: Omit<SandboxProbeCheck, 'step' | 'status' | 'code'> = {}) => checks.push({ step, status, code, ...facts });
    const report = () => ({ ok: !checks.some(check => check.status === 'FAIL'), checks });
    const guard = sandboxProbeGuard(options.environment, options.confirm);
    if (guard) { add('guard', 'FAIL', guard); return report(); }
    if (options.priceIds.length !== 6 || new Set(options.priceIds).size !== 6 ||
        options.priceIds.some(id => !validId(id, 'pri'))) {
        add('catalog', 'FAIL', 'SIX_UNIQUE_PRICES_REQUIRED'); return report();
    }
    const provider = options.provider;
    let selectedPrice: string | undefined;
    for (const id of options.priceIds) {
        try {
            const price = await provider.prices.get(id);
            const matches = price.id === id;
            add('price', matches ? 'PASS' : 'FAIL', matches ? 'PRICE_READ' : 'PRICE_MISMATCH', {
                id, providerStatus: safeStatus(price.status),
                interval: ['day', 'week', 'month', 'year'].includes(price.billingCycle?.interval ?? '')
                    ? price.billingCycle!.interval : null,
                frequency: Number.isSafeInteger(price.billingCycle?.frequency) ? price.billingCycle!.frequency : null,
                currency: /^[A-Z]{3}$/.test(price.unitPrice.currencyCode) ? price.unitPrice.currencyCode : null,
                trial: price.trialPeriod != null,
            });
            if (matches && price.status === 'active') selectedPrice ??= id;
        } catch (error) { add('price', 'FAIL', failureCode(error), { id }); }
    }
    if (!selectedPrice) { add('draft', 'FAIL', 'NO_ACTIVE_PRICE'); return report(); }
    // Reserved domain and random address: no real owner email is read or sent.
    const email = `sandbox-probe-${randomUUID()}@example.com`;
    let customerId: string;
    try {
        const customer = await provider.customers.create({ email });
        if (!validId(customer.id, 'ctm')) throw new Error();
        customerId = customer.id;
        add('customer', 'PASS', 'CUSTOMER_CREATED', { id: customerId, providerStatus: safeStatus(customer.status) });
    } catch (error) { add('customer', 'FAIL', failureCode(error)); return report(); }
    // A duplicate request uses the same disposable identity. It never adopts an existing owner.
    try {
        await provider.customers.create({ email });
        add('duplicateCustomer', 'FAIL', 'DUPLICATE_UNEXPECTEDLY_ACCEPTED');
    } catch (error) {
        const expected = error instanceof BillingProviderError && error.classification === 'CUSTOMER_EXISTS'
            && error.providerCode === 'customer_already_exists';
        add('duplicateCustomer', expected ? 'PASS' : 'FAIL', failureCode(error), {
            customerId: error instanceof BillingProviderError && validId(error.customerId, 'ctm') ? error.customerId : null,
        });
    }
    let transactionId: string | undefined;
    try {
        const draft = await provider.transactions.create({
            items: [{ priceId: selectedPrice, quantity: 1 }], customerId, collectionMode: 'automatic',
        });
        if (!validId(draft.id, 'txn')) throw new Error();
        transactionId = draft.id;
        add('draft', draft.status === 'draft' && draft.customerId === customerId ? 'PASS' : 'FAIL',
            'DRAFT_CREATED', { id: transactionId, providerStatus: safeStatus(draft.status) });
        try {
            const read = await provider.transactions.get(transactionId);
            add('readDraft', read.id === transactionId && read.customerId === customerId && read.status === 'draft'
                ? 'PASS' : 'FAIL', 'DRAFT_READ', { id: transactionId, providerStatus: safeStatus(read.status) });
        } catch (error) { add('readDraft', 'FAIL', failureCode(error), { id: transactionId }); }
        try {
            const list = await provider.transactions.list({ customerId: [customerId] });
            const found = list.data.some(row => row.id === transactionId && row.customerId === customerId);
            add('listDraft', found ? 'PASS' : 'FAIL', found ? 'DRAFT_FOUND' : list.hasMore ? 'LIST_INCOMPLETE' : 'DRAFT_NOT_FOUND',
                { id: transactionId });
        } catch (error) { add('listDraft', 'FAIL', failureCode(error), { id: transactionId }); }
    } catch (error) { add('draft', 'FAIL', failureCode(error)); }
    finally {
        if (transactionId) {
            try {
                const canceled = await provider.transactions.update(transactionId, { status: 'canceled' });
                add('cancelDraft', canceled.id === transactionId && canceled.status === 'canceled' ? 'PASS' : 'FAIL',
                    'CANCEL_RESULT', { id: transactionId, providerStatus: safeStatus(canceled.status) });
                const read = await provider.transactions.get(transactionId);
                add('readCanceledDraft', read.id === transactionId && read.customerId === customerId && read.status === 'canceled'
                    ? 'PASS' : 'FAIL', 'CANCELED_READ', { id: transactionId, providerStatus: safeStatus(read.status) });
            } catch (error) { add('cancelDraft', 'FAIL', failureCode(error), { id: transactionId }); }
        } else add('cancelDraft', 'SKIPPED', 'NO_KNOWN_TRANSACTION');
    }
    return report();
}
