import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OperatorPrincipal } from '../operatorIdentity.service.js';
import { PLATFORM_INSIGHT_FIELDS } from './contract.js';
import { getPlatformCompanyInsights } from './companyInsights.js';

const operator = { kind: 'PLATFORM_OPERATOR', issuer: 'test-issuer', subject: 'test-operator' } as const;
const asOf = new Date('2026-11-19T08:00:00Z');
const customerId = 'ctm_' + 'a'.repeat(26);
const company = {
    plan: 'PRO',
    operationalStatus: 'ACTIVE',
    suspendedAt: null as Date | null,
    billingCustomerId: null as string | null,
    managers: [{ name: 'Test owner', email: 'owner@example.test', password: 'PRIVATE' }],
    _count: { locations: 3, staff: 10, managers: 2, privateCount: 99 },
    verificationPolicy: 'PRIVATE',
};

function transaction(id: string, status: string, day: number, total: string | null) {
    return {
        id, status, total, invoiceNumber: null as string | null, currencyCode: 'USD',
        paddleCreatedAt: new Date(Date.UTC(2026, 10, day)) as Date | null,
        createdAt: new Date('2026-11-19T00:00:00Z'), customerId: 'PRIVATE',
    };
}

function harness(value: typeof company | null = company) {
    const mock = {
        company: { findUnique: vi.fn(async () => value) },
        $queryRaw: vi.fn<(query: { text: string; values: unknown[] }) => Promise<unknown[]>>().mockResolvedValue([]),
        verificationAttempt: { groupBy: vi.fn<() => Promise<{ state: string; _count: { _all: number } }[]>>().mockResolvedValue([]) },
        paddleTransaction: { findMany: vi.fn<() => Promise<ReturnType<typeof transaction>[]>>().mockResolvedValue([]) },
    };
    return { mock, db: mock as unknown as NonNullable<Parameters<typeof getPlatformCompanyInsights>[2]> };
}

afterEach(() => vi.unstubAllEnvs());

describe('company insights', () => {
    it.each([null, { role: 'ADMIN' }, { ...operator, subject: '' }])('rejects unauthorized principal %j before any read', async principal => {
        const { mock, db } = harness();
        await expect(getPlatformCompanyInsights(principal as OperatorPrincipal, '4', db, asOf))
            .rejects.toMatchObject({ statusCode: 403 });
        expect(mock.company.findUnique).not.toHaveBeenCalled();
        expect(mock.$queryRaw).not.toHaveBeenCalled();
        expect(mock.verificationAttempt.groupBy).not.toHaveBeenCalled();
        expect(mock.paddleTransaction.findMany).not.toHaveBeenCalled();
    });

    it.each(['04', '4e0', '2147483648', 0, 4.2])('rejects invalid company id %s before reading', async id => {
        const { mock, db } = harness();
        await expect(getPlatformCompanyInsights(operator, id, db, asOf)).rejects.toMatchObject({ statusCode: 400 });
        expect(mock.company.findUnique).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown company before querying metrics', async () => {
        const { mock, db } = harness(null);
        await expect(getPlatformCompanyInsights(operator, '4', db, asOf)).rejects.toMatchObject({ statusCode: 404 });
        expect(mock.$queryRaw).not.toHaveBeenCalled();
        expect(mock.verificationAttempt.groupBy).not.toHaveBeenCalled();
        expect(mock.paddleTransaction.findMany).not.toHaveBeenCalled();
    });

    it('preserves the Karachi suspension day and zeros subsequent calendar days', async () => {
        const { mock, db } = harness({
            ...company, operationalStatus: 'SUSPENDED', suspendedAt: new Date('2026-11-16T20:00:00Z'),
        });
        mock.$queryRaw.mockResolvedValueOnce([
            { companyId: 4, day: '2026-11-17', count: 2n },
            { companyId: 4, day: '2026-11-18', count: 1n },
        ]);
        const result = await getPlatformCompanyInsights(operator, '4', db, asOf);
        expect(result.calendar35).toHaveLength(35);
        expect(result.calendar35.at(0)).toEqual({ day: '2026-10-16', count: 0 });
        expect(result.calendar35.slice(-3)).toEqual([
            { day: '2026-11-17', count: 2 }, { day: '2026-11-18', count: 0 }, { day: '2026-11-19', count: 0 },
        ]);
        expect(result.activity30).toHaveLength(30);
        expect(result.activity30.at(-2)).toEqual({ day: '2026-11-18', count: 1 });
    });

    it('returns scoped aggregates, newest payments and only the specified fields', async () => {
        vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
        const { mock, db } = harness({ ...company, billingCustomerId: customerId });
        mock.$queryRaw.mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ companyId: 4, latest: new Date('2026-11-18T20:00:00Z') }])
            .mockResolvedValueOnce([{ companyId: 4, latest: new Date('2026-11-19T07:00:00Z') }])
            .mockResolvedValueOnce([{ companyId: 4, total: 4n, late: 1n }]);
        mock.verificationAttempt.groupBy.mockResolvedValue([
            { state: 'PASSED', _count: { _all: 7 } },
            { state: 'RECAPTURE_REQUIRED', _count: { _all: 3 } },
            { state: 'REVIEW_REQUIRED', _count: { _all: 2 } },
            { state: 'CLEANING_REQUIRED', _count: { _all: 1 } },
            { state: 'RESERVED', _count: { _all: 10 } },
        ]);
        mock.paddleTransaction.findMany.mockResolvedValue([
            { ...transaction('txn_1', 'completed', 10, '1200'), invoiceNumber: 'INV-1' },
            transaction('txn_2', 'past_due', 16, '700'),
            transaction('txn_3', 'draft', 19, '9999'),
            { ...transaction('txn_4', 'paid', 11, '2100'), paddleCreatedAt: null },
        ]);
        const result = await getPlatformCompanyInsights(operator, '4', db, asOf);
        expect(Object.keys(result).sort()).toEqual([...PLATFORM_INSIGHT_FIELDS['/api/platform/companies/:id/insights']].sort());
        expect(result.owner).toEqual({ name: 'Test owner', email: 'owner@example.test' });
        expect(result.usage).toEqual({ locations: 3, staff: 10, managers: 2 });
        expect(result.limits).toEqual({ locations: 5, staff: 25, managers: 3 });
        expect(result.lastActiveAt).toBe('2026-11-19T07:00:00.000Z');
        expect(result.onTimeShare).toBe(0.75);
        expect(result.photos).toEqual({ passed: 7, retake: 3, manager: 2, cleaning: 1 });
        expect(result.payments).toEqual([
            { id: 'txn_4', status: 'PAID', date: '2026-11-19T00:00:00.000Z', invoice: null, amount: { amount: 21, currency: 'USD' } },
            { id: 'txn_2', status: 'PAST_DUE', date: '2026-11-16T00:00:00.000Z', invoice: null, amount: { amount: 7, currency: 'USD' } },
            { id: 'txn_1', status: 'PAID', date: '2026-11-10T00:00:00.000Z', invoice: 'INV-1', amount: { amount: 12, currency: 'USD' } },
        ]);
        expect(result.paidToDate).toEqual({ amount: 33, currency: 'USD' });
        expect(result.paddle).toEqual({ customerUrl: 'https://sandbox-vendors.paddle.com/customers-v2/' + customerId });
        expect(JSON.stringify(result)).not.toContain('PRIVATE');
        expect(mock.verificationAttempt.groupBy).toHaveBeenCalledWith({
            by: ['state'],
            where: {
                session: { task: { location: { companyId: 4 } } },
                createdAt: { gte: new Date('2026-10-20T19:00:00Z'), lte: asOf },
            },
            _count: { _all: true },
        });
        expect(mock.paddleTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { companyId: 4, status: { in: ['completed', 'paid', 'past_due'] } },
        }));
    });

    it('returns null for missing owner, customer link, attendance and payment currency', async () => {
        const { db } = harness({ ...company, managers: [] });
        const result = await getPlatformCompanyInsights(operator, 4, db, asOf);
        expect(result).toMatchObject({
            owner: null, lastActiveAt: null, onTimeShare: null, photos: { passed: 0, retake: 0, manager: 0, cleaning: 0 },
            paidToDate: null, payments: [], paddle: null,
        });
    });

    it('keeps unknown paid amounts and totals unavailable', async () => {
        const { mock, db } = harness();
        mock.paddleTransaction.findMany.mockResolvedValue([
            transaction('txn_1', 'paid', 10, null), transaction('txn_2', 'paid', 16, '700'),
        ]);
        const result = await getPlatformCompanyInsights(operator, 4, db, asOf);
        expect(result.payments[1]?.amount).toBeNull();
        expect(result.paidToDate).toBeNull();
    });
});
