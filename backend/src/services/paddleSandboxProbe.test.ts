import { describe, expect, it, vi } from 'vitest';
import { BillingProviderError, type BillingProvider } from './billingProvider.js';
import { runPaddleSandboxProbe } from './paddleSandboxProbe.js';

const customerId = `ctm_${'a'.repeat(26)}`;
const transactionId = `txn_${'b'.repeat(26)}`;
const priceIds = Array.from({ length: 6 }, (_, index) => `pri_${String(index).padStart(26, '0')}`);
const conflict = () => new BillingProviderError('customers.create', {
    classification: 'CUSTOMER_EXISTS', providerCode: 'customer_already_exists', customerId,
});
function setup() {
    const draft = { id: transactionId, customerId, status: 'draft' };
    const canceled = { ...draft, status: 'canceled' };
    const provider = {
        prices: { get: vi.fn(async (id: string) => ({
            id, status: 'active', billingCycle: { interval: 'month', frequency: 1 },
            unitPrice: { currencyCode: 'USD' }, trialPeriod: null,
        })) },
        customers: { create: vi.fn().mockResolvedValueOnce({ id: customerId, status: 'active' }).mockRejectedValue(conflict()) },
        transactions: {
            create: vi.fn().mockResolvedValue(draft),
            get: vi.fn().mockResolvedValueOnce(draft).mockResolvedValue(canceled),
            list: vi.fn().mockResolvedValue({ data: [draft], hasMore: false }),
            update: vi.fn().mockResolvedValue(canceled),
        },
    };
    const run = (overrides: Partial<Parameters<typeof runPaddleSandboxProbe>[0]> = {}) =>
        runPaddleSandboxProbe({ environment: 'sandbox', confirm: true, priceIds,
            provider: provider as unknown as BillingProvider, ...overrides });
    return { provider, run, draft, canceled };
}

describe('Paddle sandbox probe (injected provider only)', () => {
    it.each(['production', undefined, '', 'SANDBOX'])('refuses environment %s before any provider call', async environment => {
        const { provider, run } = setup();
        expect(await run({ environment })).toEqual({ ok: false,
            checks: [{ step: 'guard', status: 'FAIL', code: 'SANDBOX_REQUIRED' }] });
        expect(provider.prices.get).not.toHaveBeenCalled();
        expect(provider.customers.create).not.toHaveBeenCalled();
    });
    it('refuses a missing confirm flag before any provider call', async () => {
        const { provider, run } = setup();
        expect((await run({ confirm: false })).checks[0].code).toBe('CONFIRM_REQUIRED');
        expect(provider.prices.get).not.toHaveBeenCalled();
        expect(provider.customers.create).not.toHaveBeenCalled();
    });
    it.each([[], priceIds.slice(1), [...priceIds.slice(1), priceIds[1]], [...priceIds.slice(1), 'secret@example.com']].map(ids => ({ ids })))(
        'requires six unique valid catalog IDs: $ids', async ({ ids }) => {
            const { provider, run } = setup();
            expect((await run({ priceIds: ids })).ok).toBe(false);
            expect(provider.prices.get).not.toHaveBeenCalled();
        });
    it('reports all six prices and verifies create, read, customer-filtered list, cancel and readback', async () => {
        const { provider, run } = setup();
        const report = await run();
        expect(report.ok).toBe(true);
        expect(report.checks.filter(check => check.step === 'price')).toEqual(priceIds.map(id => ({
            step: 'price', status: 'PASS', code: 'PRICE_READ', id, providerStatus: 'active',
            interval: 'month', frequency: 1, currency: 'USD', trial: false,
        })));
        expect(provider.transactions.create).toHaveBeenCalledExactlyOnceWith({
            items: [{ priceId: priceIds[0], quantity: 1 }], customerId, collectionMode: 'automatic',
        });
        expect(provider.transactions.create.mock.calls[0][0]).not.toHaveProperty('status');
        expect(provider.transactions.list).toHaveBeenCalledExactlyOnceWith({ customerId: [customerId] });
        expect(provider.transactions.update).toHaveBeenCalledExactlyOnceWith(transactionId, { status: 'canceled' });
        expect(report.checks.at(-1)).toMatchObject({ step: 'readCanceledDraft', status: 'PASS', providerStatus: 'canceled' });
    });
    it('reports trials without modifying prices', async () => {
        const { provider, run } = setup();
        provider.prices.get.mockResolvedValue({ id: priceIds[0], status: 'active',
            billingCycle: { interval: 'year', frequency: 1 }, unitPrice: { currencyCode: 'PKR' },
            trialPeriod: { interval: 'day', frequency: 14 } } as never);
        expect((await run()).checks[0]).toMatchObject({ trial: true, interval: 'year', currency: 'PKR' });
    });
    it('never emits customer emails, API keys, raw errors, payloads or arbitrary codes', async () => {
        const { provider, run } = setup();
        const secret = 'pdl_sdbx_apikey_super_secret';
        const email = 'private@example.com';
        provider.prices.get.mockRejectedValueOnce(new Error(`${email} ${secret}`));
        provider.customers.create.mockReset().mockResolvedValueOnce({ id: customerId, status: 'active', email,
            customData: { key: secret } }).mockRejectedValue(new BillingProviderError('customers.create', {
                classification: 'REJECTED', providerCode: secret, customerId: email,
            }));
        provider.transactions.update.mockRejectedValue({ message: secret, email });
        const output = JSON.stringify(await run());
        const sentEmail = provider.customers.create.mock.calls[0][0].email;
        expect(sentEmail).toMatch(/^sandbox-probe-.+@example\.com$/);
        expect(provider.customers.create.mock.calls[1][0].email).toBe(sentEmail);
        for (const value of [secret, email, sentEmail, 'customData', 'message']) expect(output).not.toContain(value);
    });
    it('sanitizes unexpected price statuses and metadata', async () => {
        const { provider, run } = setup();
        provider.prices.get.mockResolvedValueOnce({ id: priceIds[0], status: 'private@example.com',
            billingCycle: { interval: 'secret', frequency: Infinity }, unitPrice: { currencyCode: 'secret' }, trialPeriod: null });
        expect((await run()).checks[0]).toMatchObject({ providerStatus: 'UNKNOWN', interval: null, frequency: null, currency: null });
    });
    it('reports a cancel failure with the transaction ID for manual cleanup', async () => {
        const { provider, run } = setup();
        provider.transactions.update.mockRejectedValue(new BillingProviderError('transactions.update', {
            classification: 'UNCERTAIN', providerCode: null, customerId: null,
        }));
        const report = await run();
        expect(report.ok).toBe(false);
        expect(report.checks.at(-1)).toEqual({ step: 'cancelDraft', status: 'FAIL', code: 'UNCERTAIN', id: transactionId });
    });
    it.each(['get', 'list'] as const)('still cancels after %s fails', async operation => {
        const { provider, run } = setup();
        provider.transactions[operation].mockReset().mockRejectedValueOnce(new Error('unavailable'));
        const report = await run();
        expect(report.checks).toContainEqual(expect.objectContaining({
            step: operation === 'get' ? 'readDraft' : 'listDraft', status: 'FAIL',
        }));
        expect(provider.transactions.update).toHaveBeenCalledOnce();
    });
    it('does not claim cancellation if Paddle returns a draft', async () => {
        const { provider, run, draft } = setup();
        provider.transactions.update.mockResolvedValue(draft);
        expect((await run()).checks).toContainEqual(expect.objectContaining({ step: 'cancelDraft', status: 'FAIL' }));
    });
    it('does not claim cancellation is final if readback is still draft', async () => {
        const { provider, run, draft } = setup();
        provider.transactions.get.mockReset().mockResolvedValue(draft);
        expect((await run()).checks.at(-1)).toMatchObject({ step: 'readCanceledDraft', status: 'FAIL' });
    });
    it('reports an incomplete list without inventing an absent draft', async () => {
        const { provider, run } = setup();
        provider.transactions.list.mockResolvedValue({ data: [], hasMore: true });
        expect((await run()).checks).toContainEqual(expect.objectContaining({ step: 'listDraft', status: 'FAIL', code: 'LIST_INCOMPLETE' }));
    });
    it('rejects a draft read belonging to another customer and still cleans up', async () => {
        const { provider, run, draft } = setup();
        provider.transactions.get.mockReset().mockResolvedValueOnce({ ...draft, customerId: `ctm_${'c'.repeat(26)}` });
        expect((await run()).checks).toContainEqual(expect.objectContaining({ step: 'readDraft', status: 'FAIL' }));
        expect(provider.transactions.update).toHaveBeenCalledOnce();
    });
    it('does not create a customer without an active catalog price', async () => {
        const { provider, run } = setup();
        provider.prices.get.mockRejectedValue(new Error('offline'));
        expect((await run()).ok).toBe(false);
        expect(provider.prices.get).toHaveBeenCalledTimes(6);
        expect(provider.customers.create).not.toHaveBeenCalled();
    });
    it('reports customer creation failure without creating a transaction', async () => {
        const { provider, run } = setup();
        provider.customers.create.mockReset().mockRejectedValue(new Error('secret'));
        expect((await run()).ok).toBe(false);
        expect(provider.transactions.create).not.toHaveBeenCalled();
    });
    it('reports uncertain draft creation without retrying or guessing an ID to cancel', async () => {
        const { provider, run } = setup();
        provider.transactions.create.mockRejectedValue(new Error('timeout'));
        expect((await run()).checks.at(-1)).toMatchObject({ step: 'cancelDraft', status: 'SKIPPED', code: 'NO_KNOWN_TRANSACTION' });
        expect(provider.transactions.create).toHaveBeenCalledOnce();
        expect(provider.transactions.update).not.toHaveBeenCalled();
    });
    it('records normalized duplicate-error facts without claiming to capture raw Paddle shape', async () => {
        const { run } = setup();
        expect((await run()).checks).toContainEqual({ step: 'duplicateCustomer', status: 'PASS',
            code: 'customer_already_exists', customerId });
    });
});
