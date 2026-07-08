import { createHmac, randomBytes } from 'node:crypto';
import type { StaffLoginCode } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../utils/ApiError.js';
import { verifySessionToken } from '../../utils/auth.js';
import { createStaffLoginCodeService } from './loginCode.service.js';

vi.mock('../../prisma/prisma.js', () => ({ prisma: {} }));

const phone = '+923001234567';
const otherPhone = '+923111234567';
const staff = {
    id: 7, companyId: 42, name: 'Field Staff', email: null, locationId: 24, role: 'STAFF',
    credentialVersion: 3, isActive: true, phone,
};
const fixedRandom = () => 7 * 151;
const testCode = () => String(fixedRandom()).padStart(6, '0');
const expectedHash = () => createHmac('sha256', process.env.REFRESH_TOKEN_SECRET!)
    .update(`${phone}:${testCode()}`).digest('hex');
const start = new Date('2026-11-20T12:00:00Z').getTime();
const day = 24 * 60 * 60_000;

function fixture() {
    let at = start;
    let principal: typeof staff | null = { ...staff };
    let rows: StaffLoginCode[] = [];
    let nextId = 1;
    let refreshToken: string | null = 'old-refresh-token';
    let insideTransaction = false;
    let failedSends = false;
    let sends = 0;

    function seed(row: Partial<StaffLoginCode> = {}) {
        rows.push({
            id: nextId++, phone, staffId: staff.id, companyId: staff.companyId, codeHash: 'a'.repeat(64),
            attempts: 0, consumedAt: null, createdAt: new Date(at), expiresAt: new Date(at + 300_000),
            ...row,
        });
    }

    const newest = (target: string, unusedOnly = false) => rows
        .filter(row => row.phone === target && (!unusedOnly || row.consumedAt === null))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)[0];
    const raw = vi.fn(async (sql: TemplateStringsArray, value?: string) => {
        const query = sql.join('?');
        if (query.includes('pg_advisory_xact_lock')) return [];
        if (query.includes('WHERE id = (')) {
            return principal?.id === newest(value!, true)?.staffId ? [principal] : [];
        }
        if (query.includes('FROM "StaffLoginCode"')) {
            const row = newest(value!, true);
            return row ? [row] : [];
        }
        return principal && principal.phone === value && principal.isActive && principal.role === 'STAFF' ? [principal] : [];
    });
    const codes = {
        findFirst: vi.fn(async ({ where }: { where: { phone: string } }) => newest(where.phone)),
        count: vi.fn(async ({ where }: { where: { phone?: string; createdAt: { gt: Date } } }) =>
            rows.filter(row => (!where.phone || row.phone === where.phone) && row.createdAt > where.createdAt.gt).length),
        create: vi.fn(async ({ data }: { data: Partial<StaffLoginCode> }) => {
            seed(data);
            return { id: rows.at(-1)!.id };
        }),
        update: vi.fn(async ({ where, data }: { where: { id: number }; data: Partial<StaffLoginCode> }) => {
            Object.assign(rows.find(row => row.id === where.id)!, data);
        }),
        updateMany: vi.fn(async ({ where, data }: {
            where: { id?: number; phone?: string; consumedAt: null };
            data: Pick<StaffLoginCode, 'consumedAt'>;
        }) => {
            for (const row of rows) {
                if ((where.id === undefined || row.id === where.id) &&
                    (where.phone === undefined || row.phone === where.phone) && row.consumedAt === null) {
                    row.consumedAt = data.consumedAt;
                }
            }
        }),
    };
    const staffUpdate = vi.fn(async ({ data }: { data: { refreshToken: string } }) => {
        refreshToken = data.refreshToken;
    });
    const tx = { $queryRaw: raw, staffLoginCode: codes, staff: { update: staffUpdate } };
    const transaction = vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => {
        const previousRows = structuredClone(rows);
        const previousToken = refreshToken;
        insideTransaction = true;
        try {
            return await work(tx);
        } catch (error) {
            rows = previousRows;
            refreshToken = previousToken;
            throw error;
        } finally {
            insideTransaction = false;
        }
    });
    const service = createStaffLoginCodeService({
        prisma: { $transaction: transaction, staffLoginCode: codes } as unknown as Parameters<typeof createStaffLoginCodeService>[0]['prisma'],
        now: () => new Date(at),
        randomInt: fixedRandom,
        sendSms: async (recipient, code) => {
            sends++;
            expect(insideTransaction).toBe(false);
            expect(recipient).toBe(phone);
            expect(code === testCode()).toBe(true);
            expect(newest(phone)?.codeHash).toBe(expectedHash());
            if (failedSends) throw new Error('Sender rejected the request');
            return { accepted: true, batchId: 'test-batch' };
        },
    });
    return {
        service, raw, codes, transaction, staffUpdate, seed,
        get rows() { return rows; },
        get sends() { return sends; },
        get refreshToken() { return refreshToken; },
        advance: (milliseconds: number) => { at += milliseconds; },
        setStaff: (value: typeof staff | null) => { principal = value; },
        failSend: () => { failedSends = true; },
    };
}

function errorOf(statusCode: number, code: string, details = {}) {
    return { statusCode, errors: [{ code, ...details }] };
}

beforeEach(() => {
    vi.stubEnv('REFRESH_TOKEN_SECRET', randomBytes(32).toString('hex'));
    vi.stubEnv('ACCESS_TOKEN_SECRET', randomBytes(32).toString('hex'));
    vi.stubEnv('ACCESS_TOKEN_EXPIRY', '5m');
    vi.stubEnv('STAFF_REFRESH_TOKEN_EXPIRY', '14d');
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe('requesting a staff code', () => {
    it('normalizes the phone, commits a hash and sends once after commit', async () => {
        const f = fixture();
        expect(await f.service.requestCode('(0300) 123-4567')).toEqual({
            phone, expiresInSeconds: 300, resendAfterSeconds: 60,
        });
        expect(f.sends).toBe(1);
        expect(f.rows).toEqual([{
            id: 1, staffId: staff.id, companyId: staff.companyId, phone, codeHash: expectedHash(),
            attempts: 0, consumedAt: null, createdAt: new Date(start), expiresAt: new Date(start + 300_000),
        }]);
        const queries = f.raw.mock.calls.map(([sql]) => sql.join('?'));
        expect(queries[0]).toContain('pg_advisory_xact_lock');
        expect(queries[1]).toContain('staff-login-code:daily-cap');
        expect(f.raw.mock.invocationCallOrder[1]).toBeLessThan(f.codes.count.mock.invocationCallOrder[0]!);
    });

    it('rejects an invalid phone without starting a transaction or sending', async () => {
        const f = fixture();
        await expect(f.service.requestCode('not-a-phone')).rejects.toMatchObject(errorOf(400, 'INVALID_PHONE'));
        expect(f.transaction).not.toHaveBeenCalled();
        expect(f.sends).toBe(0);
    });

    it.each([null, { ...staff, isActive: false }])('rejects unregistered or inactive accounts (%#)', async principal => {
        const f = fixture();
        f.setStaff(principal);
        await expect(f.service.requestCode(phone)).rejects.toMatchObject(errorOf(404, 'PHONE_NOT_REGISTERED'));
        expect(f.rows).toHaveLength(0);
        expect(f.sends).toBe(0);
        expect(f.codes.count).not.toHaveBeenCalled();
    });

    it('checks the resend wait first and rounds the remaining time up', async () => {
        const f = fixture();
        f.seed();
        f.advance(42_001);
        await expect(f.service.requestCode(phone)).rejects.toMatchObject({
            ...errorOf(429, 'CODE_RESEND_WAIT', { retryAfterSeconds: 18 }),
            message: 'Wait 18 seconds before asking for a new code.',
        });
        expect(f.codes.count).not.toHaveBeenCalled();
        expect(f.sends).toBe(0);
    });

    it('rejects the sixth phone code before checking the system cap', async () => {
        const f = fixture();
        for (let i = 0; i < 5; i++) f.seed({ createdAt: new Date(start - 60_000), consumedAt: new Date(start) });
        await expect(f.service.requestCode(phone)).rejects.toMatchObject(errorOf(429, 'PHONE_DAILY_LIMIT'));
        expect(f.codes.count).toHaveBeenCalledOnce();
        expect(f.rows).toHaveLength(5);
        expect(f.sends).toBe(0);
    });

    it('rejects the forty-first system code and allows a slot exactly 24 hours later', async () => {
        const f = fixture();
        for (let i = 0; i < 40; i++) {
            f.seed({ phone: otherPhone, createdAt: new Date(start - (i === 0 ? day - 1 : 60_000)) });
        }
        await expect(f.service.requestCode(phone)).rejects.toMatchObject(errorOf(503, 'SMS_DAILY_LIMIT'));
        expect(f.rows).toHaveLength(40);
        expect(f.sends).toBe(0);
        f.advance(1);
        await expect(f.service.requestCode(phone)).resolves.toMatchObject({ phone });
        expect(f.sends).toBe(1);
    });

    it.each([
        { prior: 4, priorPhone: phone, status: 429, limit: 'PHONE_DAILY_LIMIT' },
        { prior: 39, priorPhone: otherPhone, status: 503, limit: 'SMS_DAILY_LIMIT' },
    ])('consumes a failed send and counts it toward $limit', async ({ prior, priorPhone, status, limit }) => {
        const f = fixture();
        for (let i = 0; i < prior; i++) f.seed({ phone: priorPhone, createdAt: new Date(start - 60_000) });
        f.failSend();
        await expect(f.service.requestCode(phone)).rejects.toMatchObject(errorOf(503, 'SMS_UNAVAILABLE'));
        expect(f.rows.at(-1)?.consumedAt).toEqual(new Date(start));
        f.advance(60_000);
        await expect(f.service.requestCode(phone)).rejects.toMatchObject(errorOf(status, limit));
        expect(f.sends).toBe(1);
    });

    it('consumes every older code for the same phone at the exact resend boundary', async () => {
        const f = fixture();
        f.seed();
        f.seed();
        f.seed({ phone: otherPhone });
        f.advance(60_000);
        await f.service.requestCode(phone);
        expect(f.rows.map(row => row.consumedAt)).toEqual([new Date(start + 60_000), new Date(start + 60_000), null, null]);
    });

    it('keeps the code out of return values, persistence, errors and logs', async () => {
        const f = fixture();
        const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
        logs.forEach(log => log.mockImplementation(() => {}));
        const result = await f.service.requestCode(phone);
        f.advance(60_000);
        f.failSend();
        const error: unknown = await f.service.requestCode(phone).catch((error: unknown) => error);
        expect(error).toBeInstanceOf(ApiError);
        const metadata = f.rows.map(({ codeHash, ...row }) => row);
        const output = [JSON.stringify(result), JSON.stringify(metadata), String(error), JSON.stringify(error),
            JSON.stringify(logs.map(log => log.mock.calls))].join('\n');
        expect(output.includes(testCode())).toBe(false);
    });
});

describe('verifying a staff code', () => {
    it('issues staff tokens, replaces the saved refresh token and consumes all codes for that phone', async () => {
        const f = fixture();
        f.seed({ phone: otherPhone });
        await f.service.requestCode(phone);
        f.seed({ createdAt: new Date(start - 60_000) });
        const result = await f.service.verifyCode('0300 1234567', testCode());
        expect(result).toEqual({
            id: staff.id, companyId: staff.companyId, locationId: staff.locationId, name: staff.name,
            email: null, role: 'STAFF', accessToken: expect.any(String), refreshToken: expect.any(String),
        });
        for (const [token, purpose] of [[result.accessToken, 'access'], [result.refreshToken, 'refresh']] as const) {
            expect(verifySessionToken(token, purpose)).toMatchObject({
                id: staff.id, role: 'STAFF', credentialVersion: staff.credentialVersion,
            });
        }
        expect(f.refreshToken).toBe(result.refreshToken);
        expect(f.rows.map(row => row.consumedAt)).toEqual([null, new Date(start), new Date(start)]);
        const [, staffQuery, codeQuery] = f.raw.mock.calls.slice(-3);
        expect(staffQuery?.[0].join('?')).toContain('FOR UPDATE');
        expect(codeQuery?.[0].join('?')).toContain('FOR UPDATE');
        await expect(f.service.verifyCode(phone, testCode())).rejects.toMatchObject(errorOf(410, 'CODE_EXPIRED'));
        expect(f.staffUpdate).toHaveBeenCalledOnce();
    });

    it('commits each wrong attempt and consumes the code on the fifth', async () => {
        const f = fixture();
        await f.service.requestCode(phone);
        const wrong = () => f.service.verifyCode(phone, String(fixedRandom() + 1).padStart(6, '0'));
        for (let attempts = 1; attempts < 5; attempts++) {
            const attemptsLeft = 5 - attempts;
            await expect(wrong()).rejects.toMatchObject({
                ...errorOf(400, 'CODE_WRONG', { attemptsLeft }),
                message: `That code is not right. ${attemptsLeft} tries left.`,
            });
            expect(f.rows[0]).toMatchObject({ attempts, consumedAt: null });
        }
        await expect(wrong()).rejects.toMatchObject({
            ...errorOf(410, 'CODE_LOCKED'), message: 'Too many wrong tries. Ask for a new code.',
        });
        expect(f.rows[0]).toMatchObject({ attempts: 5, consumedAt: new Date(start) });
        await expect(f.service.verifyCode(phone, testCode())).rejects.toMatchObject(errorOf(410, 'CODE_EXPIRED'));
        expect(f.staffUpdate).not.toHaveBeenCalled();
    });

    it('expires the code at five minutes without charging an attempt', async () => {
        const f = fixture();
        await f.service.requestCode(phone);
        f.advance(300_000);
        await expect(f.service.verifyCode(phone, testCode())).rejects.toMatchObject({
            ...errorOf(410, 'CODE_EXPIRED'), message: 'This code has expired. Ask for a new code.',
        });
        expect(f.rows[0]?.attempts).toBe(0);
        expect(f.staffUpdate).not.toHaveBeenCalled();
    });

    it.each([{ ...staff, phone: otherPhone }, { ...staff, isActive: false }])(
        'consumes a code for staff whose identity changed after sending (%#)', async principal => {
            const f = fixture();
            await f.service.requestCode(phone);
            f.setStaff(principal);
            await expect(f.service.verifyCode(phone, testCode())).rejects.toMatchObject(errorOf(404, 'PHONE_NOT_REGISTERED'));
            expect(f.rows[0]).toMatchObject({ attempts: 0, consumedAt: new Date(start) });
            expect(f.staffUpdate).not.toHaveBeenCalled();
        },
    );

    it('rejects a five-digit code without counting an attempt or reading a row', async () => {
        const f = fixture();
        await f.service.requestCode(phone);
        f.transaction.mockClear();
        await expect(f.service.verifyCode(phone, testCode().slice(1))).rejects.toMatchObject(errorOf(400, 'INVALID_REQUEST'));
        expect(f.transaction).not.toHaveBeenCalled();
        expect(f.rows[0]?.attempts).toBe(0);
    });

    it('rejects a row already at the attempt limit', async () => {
        const f = fixture();
        f.seed({ attempts: 5 });
        await expect(f.service.verifyCode(phone, testCode())).rejects.toMatchObject(errorOf(410, 'CODE_LOCKED'));
        expect(f.rows[0]?.consumedAt).toEqual(new Date(start));
    });
});
