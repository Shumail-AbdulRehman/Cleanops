import { ApiError, type Customer, type Transaction } from '@paddle/paddle-node-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOperationalLogger } from '../utils/operationalLog.js';
import { getPaddleClient } from '../config/paddle.js';
import {
    BILLING_PROVIDER_MAX_PAGES, BILLING_PROVIDER_PAGE_SIZE, BILLING_PROVIDER_TIMEOUT_MS,
    BillingProviderError, classifyBillingProviderError, createBillingProvider,
    type BillingProviderClient,
} from './billingProvider.js';

vi.mock('../config/paddle.js', () => ({ getPaddleClient: vi.fn() }));

const customerId = `ctm_${'a'.repeat(26)}`;
const otherCustomerId = `ctm_${'b'.repeat(26)}`;
const privateDetail = 'owner@example.invalid token=private-token card=private-card';
function apiError(type = 'request_error', code = 'invalid_field', detail = privateDetail) {
    return new ApiError({ type, code, detail, documentation_url: 'https://example.invalid/private',
        errors: [{ field: 'email', message: privateDetail }] }, null);
}

function harness() {
    const value = { id: 'provider-result' };
    const customerPage = { hasMore: false, next: vi.fn().mockResolvedValue([value]) };
    const transactionPage = { hasMore: false, next: vi.fn().mockResolvedValue([value]) };
    const client = {
        customers: { create: vi.fn().mockResolvedValue(value), list: vi.fn().mockReturnValue(customerPage) },
        prices: { get: vi.fn().mockResolvedValue(value), update: vi.fn().mockResolvedValue(value) },
        products: { get: vi.fn().mockResolvedValue(value) },
        transactions: { create: vi.fn().mockResolvedValue(value), get: vi.fn().mockResolvedValue(value),
            list: vi.fn().mockReturnValue(transactionPage), update: vi.fn().mockResolvedValue(value) },
        subscriptions: { get: vi.fn().mockResolvedValue(value) },
        customerPortalSessions: { create: vi.fn().mockResolvedValue(value) },
    } satisfies BillingProviderClient;
    const lines: string[] = [];
    const provider = createBillingProvider({ client, log: createOperationalLogger(line => lines.push(line)) });
    return { client, provider, lines, value, customerPage, transactionPage };
}
type Harness = ReturnType<typeof harness>;
const operations = [
    { name: 'customers.create', invoke: (h: Harness) => h.provider.customers.create({ email: 'owner@example.invalid', name: privateDetail }),
        mock: (h: Harness) => h.client.customers.create, args: [{ email: 'owner@example.invalid', name: privateDetail }] },
    { name: 'customers.list', invoke: (h: Harness) => h.provider.customers.list({ email: 'owner@example.invalid', status: ['active', 'archived'] }),
        mock: (h: Harness) => h.customerPage.next, args: [] },
    { name: 'prices.get', invoke: (h: Harness) => h.provider.prices.get('pri_fixture', { include: ['product'] }),
        mock: (h: Harness) => h.client.prices.get, args: ['pri_fixture', { include: ['product'] }] },
    { name: 'products.get', invoke: (h: Harness) => h.provider.products.get('pro_fixture'),
        mock: (h: Harness) => h.client.products.get, args: ['pro_fixture'] },
    { name: 'prices.update', invoke: (h: Harness) => h.provider.prices.update('pri_fixture', { trialPeriod: null, billingCycle: { interval: 'month', frequency: 1 } }),
        mock: (h: Harness) => h.client.prices.update, args: ['pri_fixture', { trialPeriod: null, billingCycle: { interval: 'month', frequency: 1 } }] },
    { name: 'transactions.create', invoke: (h: Harness) => h.provider.transactions.create({ items: [], customerId, customData: { privateDetail } }, { include: ['customer'] }),
        mock: (h: Harness) => h.client.transactions.create, args: [{ items: [], customerId, customData: { privateDetail } }, { include: ['customer'] }] },
    { name: 'transactions.get', invoke: (h: Harness) => h.provider.transactions.get('txn_fixture', { include: ['customer'] }),
        mock: (h: Harness) => h.client.transactions.get, args: ['txn_fixture', { include: ['customer'] }] },
    { name: 'transactions.list', invoke: (h: Harness) => h.provider.transactions.list({ customerId: [customerId], status: ['draft', 'ready'] }),
        mock: (h: Harness) => h.transactionPage.next, args: [] },
    { name: 'transactions.update', invoke: (h: Harness) => h.provider.transactions.update('txn_fixture', { status: 'canceled' }, { include: ['customer'] }),
        mock: (h: Harness) => h.client.transactions.update, args: ['txn_fixture', { status: 'canceled' }, { include: ['customer'] }] },
    { name: 'subscriptions.get', invoke: (h: Harness) => h.provider.subscriptions.get('sub_fixture'),
        mock: (h: Harness) => h.client.subscriptions.get, args: ['sub_fixture'] },
    { name: 'customerPortalSessions.create', invoke: (h: Harness) => h.provider.customerPortalSessions.create(customerId, ['sub_fixture']),
        mock: (h: Harness) => h.client.customerPortalSessions.create, args: [customerId, ['sub_fixture']] },
];

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('provider failure classification', () => {
    it.each([
        ['request error', apiError(), 'REJECTED', 'invalid_field'],
        ['rate limit', apiError('request_error', 'too_many_requests'), 'RATE_LIMITED', 'too_many_requests'],
        ['rate limit before type', apiError('api_error', 'too_many_requests'), 'RATE_LIMITED', 'too_many_requests'],
        ['customer conflict', apiError('request_error', 'customer_already_exists'), 'CUSTOMER_EXISTS', 'customer_already_exists'],
        ['provider failure', apiError('api_error', 'internal_error'), 'UNCERTAIN', 'internal_error'],
        ['unknown SDK type', apiError('future_error', 'future_code'), 'UNCERTAIN', 'future_code'],
        ['network', new TypeError('fetch failed with private payload'), 'UNCERTAIN', null],
        ['timeout', new Error('timeout'), 'UNCERTAIN', null],
        ['abort', new DOMException('aborted', 'AbortError'), 'UNCERTAIN', null],
        ['lookalike request', { type: 'request_error', code: 'invalid_field' }, 'UNCERTAIN', null],
        ['lookalike conflict', { type: 'request_error', code: 'customer_already_exists', detail: customerId }, 'UNCERTAIN', null],
        ['null', null, 'UNCERTAIN', null],
        ['undefined', undefined, 'UNCERTAIN', null],
        ['string', privateDetail, 'UNCERTAIN', null],
        ['number', 503, 'UNCERTAIN', null],
        ['unsafe SDK code', apiError('api_error', privateDetail), 'UNCERTAIN', null],
    ])('%s', (_, error, classification, providerCode) => {
        expect(classifyBillingProviderError(error)).toEqual({ classification, providerCode, customerId: null });
    });

    it.each([
        ['documented detail', `Customer email conflicts with existing customer ID ${customerId}`, customerId],
        ['punctuation', `Customer (${customerId}). ${privateDetail}`, customerId],
        ['repeated same ID', `${customerId} ${customerId}`, customerId],
        ['missing ID', privateDetail, null],
        ['short ID', 'ctm_abc', null],
        ['long ID', `${customerId}a`, null],
        ['embedded ID', `prefix${customerId}`, null],
        ['ID suffix', `${customerId}_suffix`, null],
        ['uppercase ID', `ctm_${'A'.repeat(26)}`, null],
        ['ambiguous IDs', `${customerId} ${otherCustomerId}`, null],
    ])('parses the existing customer: %s', (_, detail, expectedId) => {
        expect(classifyBillingProviderError(apiError('request_error', 'customer_already_exists', detail)))
            .toEqual({ classification: 'CUSTOMER_EXISTS', providerCode: 'customer_already_exists', customerId: expectedId });
    });
});

describe.each(operations)('$name gateway', operation => {
    it('forwards SDK arguments, returns the result and cleans up its deadline', async () => {
        vi.useFakeTimers();
        const h = harness();
        expect(await operation.invoke(h)).toEqual(operation.name.endsWith('.list') ? { data: [h.value], hasMore: false } : h.value);
        expect(operation.mock(h)).toHaveBeenCalledExactlyOnceWith(...operation.args);
        expect(vi.getTimerCount()).toBe(0);
        expect(h.lines).toEqual([]);
    });

    it('classifies and logs a provider rejection without payloads', async () => {
        const h = harness();
        operation.mock(h).mockRejectedValue(apiError());
        await expect(operation.invoke(h)).rejects.toMatchObject({ name: 'BillingProviderError',
            operation: operation.name, classification: 'REJECTED', providerCode: 'invalid_field', customerId: null });
        expect(h.lines.map(line => JSON.parse(line))).toEqual([{
            event: `BILLING_PROVIDER_${operation.name.replaceAll('.', '_').toUpperCase()}_FAILED`,
            errorClass: 'REJECTED', providerCode: 'invalid_field',
        }]);
        expect(h.lines.join('')).not.toContain('owner@');
        expect(h.lines.join('')).not.toContain('private');
    });

    it('ends a hung request at 15 seconds with UNCERTAIN and one safe log', async () => {
        vi.useFakeTimers();
        const h = harness();
        operation.mock(h).mockReturnValue(new Promise(() => {}));
        const observed = operation.invoke(h).catch(error => error);
        await vi.advanceTimersByTimeAsync(BILLING_PROVIDER_TIMEOUT_MS - 1);
        expect(h.lines).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(await observed).toMatchObject({ operation: operation.name, classification: 'UNCERTAIN', providerCode: null });
        expect(h.lines.map(line => JSON.parse(line))).toEqual([{
            event: `BILLING_PROVIDER_${operation.name.replaceAll('.', '_').toUpperCase()}_FAILED`, errorClass: 'UNCERTAIN',
        }]);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('deadline and safe errors', () => {
    it.each(['resolve', 'reject'] as const)('discards a late %s without another log or result', async settlement => {
        vi.useFakeTimers();
        const h = harness();
        let resolve!: (value: unknown) => void;
        let reject!: (reason: unknown) => void;
        h.client.customers.create.mockReturnValue(new Promise((yes, no) => { resolve = yes; reject = no; }));
        const observed = h.provider.customers.create({ email: 'owner@example.invalid' }).catch(error => error);
        await vi.advanceTimersByTimeAsync(BILLING_PROVIDER_TIMEOUT_MS);
        const failure = await observed;
        expect(failure).toBeInstanceOf(BillingProviderError);
        expect(failure.classification).toBe('UNCERTAIN');
        if (settlement === 'resolve') resolve({ id: customerId });
        else reject(apiError());
        await vi.advanceTimersByTimeAsync(60_000);
        expect(await observed).toBe(failure);
        expect(h.lines).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        [apiError('request_error', 'too_many_requests'), 'RATE_LIMITED'],
        [apiError('request_error', 'customer_already_exists', `${privateDetail} ${customerId}`), 'CUSTOMER_EXISTS'],
        [apiError('api_error', 'internal_error'), 'UNCERTAIN'],
        [new TypeError(privateDetail), 'UNCERTAIN'],
        [apiError('api_error', privateDetail), 'UNCERTAIN'],
    ])('returns a safe classified error and only logs operation/class/code', async (error, classification) => {
        const h = harness();
        h.client.customers.create.mockRejectedValue(error);
        const failure = await h.provider.customers.create({ email: 'owner@example.invalid' }).catch(error => error);
        expect(failure).toBeInstanceOf(BillingProviderError);
        expect(failure.classification).toBe(classification);
        expect(failure).not.toHaveProperty('cause');
        expect(failure).not.toHaveProperty('detail');
        expect(`${failure.stack} ${JSON.stringify(failure)} ${h.lines.join('')}`).not.toContain('private');
        expect(h.lines.join('')).not.toContain(customerId);
        expect(Object.keys(JSON.parse(h.lines[0])).sort()).toEqual(
            error instanceof ApiError && error.code !== privateDetail ? ['errorClass', 'event', 'providerCode'] : ['errorClass', 'event']);
    });

    it('classifies synchronous SDK failures and clears the deadline', async () => {
        vi.useFakeTimers();
        const h = harness();
        h.client.products.get.mockImplementation(() => { throw apiError(); });
        await expect(h.provider.products.get('pro_fixture')).rejects.toMatchObject({ classification: 'REJECTED' });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('uses the existing client factory lazily and keeps SDK method receivers', async () => {
        const h = harness();
        vi.mocked(getPaddleClient).mockReturnValue(h.client as unknown as ReturnType<typeof getPaddleClient>);
        const provider = createBillingProvider();
        expect(getPaddleClient).not.toHaveBeenCalled();
        h.client.prices.get.mockImplementation(function (this: unknown) {
            expect(this).toBe(h.client.prices);
            return Promise.resolve(h.value);
        });
        expect(await provider.prices.get('pri_fixture')).toBe(h.value);
        expect(getPaddleClient).toHaveBeenCalledTimes(1);
    });
});

describe('bounded list helpers', () => {
    it('uses exact email and explicit status filters without a search query', async () => {
        const h = harness();
        await h.provider.customers.list({ email: 'Owner@example.invalid', status: ['active', 'archived'] });
        expect(h.client.customers.list).toHaveBeenCalledExactlyOnceWith({
            email: ['Owner@example.invalid'], status: ['active', 'archived'], perPage: BILLING_PROVIDER_PAGE_SIZE,
        });
    });

    it('preserves transaction filters and enforces the page size', async () => {
        const h = harness();
        await h.provider.transactions.list({ customerId: [customerId], status: ['draft'],
            'createdAt[GTE]': '2026-11-09T00:00:00Z', after: 'txn_cursor', perPage: 999 });
        expect(h.client.transactions.list).toHaveBeenCalledExactlyOnceWith({
            customerId: [customerId], status: ['draft'], 'createdAt[GTE]': '2026-11-09T00:00:00Z',
            after: 'txn_cursor', perPage: BILLING_PROVIDER_PAGE_SIZE,
        });
    });

    it.each(['customers', 'transactions'] as const)('bounds %s pages and reports an incomplete search', async resource => {
        const h = harness();
        const page = resource === 'customers' ? h.customerPage : h.transactionPage;
        page.hasMore = true;
        const result = resource === 'customers'
            ? await h.provider.customers.list({ email: 'owner@example.invalid', status: ['active'] })
            : await h.provider.transactions.list({ customerId: [customerId] });
        expect(result).toEqual({ data: Array(BILLING_PROVIDER_MAX_PAGES).fill(h.value), hasMore: true });
        expect(page.next).toHaveBeenCalledTimes(BILLING_PROVIDER_MAX_PAGES);
        expect(h.client[resource].list).toHaveBeenCalledTimes(1);
        expect(h.lines).toEqual([]);
    });

    it('accumulates pages in order and stops immediately when complete', async () => {
        const h = harness();
        const second = { id: 'second' };
        h.customerPage.hasMore = true;
        h.customerPage.next.mockResolvedValueOnce([h.value]).mockImplementationOnce(async () => {
            h.customerPage.hasMore = false;
            return [second];
        });
        expect(await h.provider.customers.list({ email: 'owner@example.invalid', status: ['archived'] }))
            .toEqual({ data: [h.value, second], hasMore: false });
        expect(h.customerPage.next).toHaveBeenCalledTimes(2);
    });

    it('returns a genuinely empty complete result', async () => {
        const h = harness();
        h.transactionPage.next.mockResolvedValue([]);
        expect(await h.provider.transactions.list({ customerId: [customerId] })).toEqual({ data: [], hasMore: false });
    });

    it('does not interpret a later-page failure as an empty or complete search', async () => {
        const h = harness();
        h.transactionPage.hasMore = true;
        h.transactionPage.next.mockResolvedValueOnce([h.value]).mockRejectedValueOnce(apiError('api_error', 'internal_error'));
        await expect(h.provider.transactions.list({ customerId: [customerId] })).rejects.toMatchObject({ classification: 'UNCERTAIN' });
        expect(h.transactionPage.next).toHaveBeenCalledTimes(2);
        expect(h.lines).toHaveLength(1);
    });

    it('classifies collection construction failures through the same gateway', async () => {
        const h = harness();
        h.client.customers.list.mockImplementation(() => { throw apiError(); });
        await expect(h.provider.customers.list({ email: 'owner@example.invalid', status: ['active'] }))
            .rejects.toMatchObject({ classification: 'REJECTED', operation: 'customers.list' });
        expect(h.lines).toHaveLength(1);
    });

    it('gives every page its own deadline and bounds the total number of calls', async () => {
        vi.useFakeTimers();
        const h = harness();
        h.transactionPage.hasMore = true;
        h.transactionPage.next.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve([h.value]), 14_000)));
        const result = h.provider.transactions.list({ customerId: [customerId] });
        await vi.advanceTimersByTimeAsync(14_000 * BILLING_PROVIDER_MAX_PAGES);
        expect(await result).toEqual({ data: Array(BILLING_PROVIDER_MAX_PAGES).fill(h.value), hasMore: true });
        expect(h.lines).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('times out a hung later page without returning partial results', async () => {
        vi.useFakeTimers();
        const h = harness();
        h.customerPage.hasMore = true;
        h.customerPage.next.mockResolvedValueOnce([h.value]).mockReturnValueOnce(new Promise(() => {}));
        const observed = h.provider.customers.list({ email: 'owner@example.invalid', status: ['active'] }).catch(error => error);
        await vi.advanceTimersByTimeAsync(BILLING_PROVIDER_TIMEOUT_MS);
        expect(await observed).toMatchObject({ classification: 'UNCERTAIN', operation: 'customers.list' });
        expect(h.customerPage.next).toHaveBeenCalledTimes(2);
        expect(h.lines).toHaveLength(1);
    });
});

// Compile-time check: production SDK collections satisfy the narrow injected seam.
const sdkCompatibility = (sdk: ReturnType<typeof getPaddleClient>): BillingProviderClient => sdk;
void sdkCompatibility;
// Keep the list response entity types tied to the installed SDK.
type CustomerResult = Awaited<ReturnType<ReturnType<typeof createBillingProvider>['customers']['list']>>['data'][number];
type TransactionResult = Awaited<ReturnType<ReturnType<typeof createBillingProvider>['transactions']['list']>>['data'][number];
const entityCompatibility = (customer: CustomerResult, transaction: TransactionResult): [Customer, Transaction] => [customer, transaction];
void entityCompatibility;
