import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Staff, StaffLoginCode } from '@prisma/client';
import { prisma } from '../../prisma/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { generateAccessToken, generateRefreshToken } from '../../utils/auth.js';
import { INVALID_PAKISTAN_PHONE_MESSAGE, normalizePakistanPhone } from '../../utils/pakistanPhone.js';
import { sendSms, type SmsSender } from './smsSender.js';

const EXPIRES_IN_SECONDS = 300;
const RESEND_AFTER_SECONDS = 60;
const MAX_ATTEMPTS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

type Db = Pick<typeof prisma, '$transaction' | 'staffLoginCode'>;
type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type CodeRow = Pick<StaffLoginCode, 'id' | 'staffId' | 'companyId' | 'codeHash' | 'attempts' | 'expiresAt'>;
type StaffRow = Pick<Staff, 'id' | 'companyId' | 'locationId' | 'name' | 'email' | 'phone' | 'role' | 'isActive' | 'credentialVersion'>;
type Dependencies = {
    prisma: Db;
    sendSms: SmsSender;
    now: () => Date;
    randomInt: (max: number) => number;
};

const phoneNotRegistered = () => new ApiError(404, 'This number is not registered. Ask your manager to add you.', [{ code: 'PHONE_NOT_REGISTERED' }]);
const codeExpired = () => new ApiError(410, 'This code has expired. Ask for a new code.', [{ code: 'CODE_EXPIRED' }]);
const codeLocked = () => new ApiError(410, 'Too many wrong tries. Ask for a new code.', [{ code: 'CODE_LOCKED' }]);

function requirePhone(value: unknown) {
    const phone = normalizePakistanPhone(value);
    if (!phone) throw new ApiError(400, INVALID_PAKISTAN_PHONE_MESSAGE, [{ code: 'INVALID_PHONE' }]);
    return phone;
}

function hashCode(phone: string, code: string) {
    const secret = process.env.REFRESH_TOKEN_SECRET;
    if (!secret) throw new Error('Staff sign-in requires a refresh token secret');
    return createHmac('sha256', secret).update(phone).update(':').update(code).digest();
}

async function lockPhone(tx: Transaction, phone: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'staff-login-code:' + phone}, 0))::text`;
}

export function createStaffLoginCodeService({ prisma: db, sendSms, now, randomInt }: Dependencies) {
    async function requestCode(rawPhone: unknown) {
        const phone = requirePhone(rawPhone);
        let code: string;
        const id = await db.$transaction(async tx => {
            await lockPhone(tx, phone);
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('staff-login-code:daily-cap', 0))::text`;
            const [staff] = await tx.$queryRaw<Pick<StaffRow, 'id' | 'companyId'>[]>`
                SELECT id, "companyId" FROM "Staff"
                WHERE phone = ${phone} AND "isActive" AND role = 'STAFF'
                FOR UPDATE
            `;
            if (!staff) throw phoneNotRegistered();

            const at = now();
            const latest = await tx.staffLoginCode.findFirst({
                where: { phone }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { createdAt: true },
            });
            if (latest) {
                const retryAfterSeconds = Math.ceil((latest.createdAt.getTime() + RESEND_AFTER_SECONDS * 1000 - at.getTime()) / 1000);
                if (retryAfterSeconds > 0) {
                    throw new ApiError(429, `Wait ${retryAfterSeconds} seconds before asking for a new code.`, [
                        { code: 'CODE_RESEND_WAIT', retryAfterSeconds },
                    ]);
                }
            }

            const createdAt = { gt: new Date(at.getTime() - DAY_MS) };
            if (await tx.staffLoginCode.count({ where: { phone, createdAt } }) >= 5) {
                throw new ApiError(429, "This number has reached today's code limit. Try again tomorrow or ask your manager.", [
                    { code: 'PHONE_DAILY_LIMIT' },
                ]);
            }
            if (await tx.staffLoginCode.count({ where: { createdAt } }) >= 40) {
                throw new ApiError(503, 'Sign-in codes are used up for today. Ask your manager.', [{ code: 'SMS_DAILY_LIMIT' }]);
            }

            code = String(randomInt(1_000_000)).padStart(6, '0');
            const codeHash = hashCode(phone, code).toString('hex');
            await tx.staffLoginCode.updateMany({ where: { phone, consumedAt: null }, data: { consumedAt: at } });
            const row = await tx.staffLoginCode.create({
                data: {
                    staffId: staff.id, companyId: staff.companyId, phone, codeHash, createdAt: at,
                    expiresAt: new Date(at.getTime() + EXPIRES_IN_SECONDS * 1000),
                },
                select: { id: true },
            });
            return row.id;
        }, { isolationLevel: 'ReadCommitted' });

        try {
            await sendSms(phone, code!);
        } catch {
            await db.staffLoginCode.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: now() } });
            throw new ApiError(503, 'The code could not be sent. Try again in a few minutes.', [{ code: 'SMS_UNAVAILABLE' }]);
        }
        return { phone, expiresInSeconds: EXPIRES_IN_SECONDS, resendAfterSeconds: RESEND_AFTER_SECONDS };
    }

    async function verifyCode(rawPhone: unknown, code: unknown) {
        const phone = requirePhone(rawPhone);
        if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) {
            throw new ApiError(400, 'Check the request details', [{ code: 'INVALID_REQUEST' }]);
        }

        const result = await db.$transaction(async tx => {
            await lockPhone(tx, phone);
            // Staff edits and cascading deletes acquire the staff lock before touching dependent rows.
            const [staff] = await tx.$queryRaw<StaffRow[]>`
                SELECT id, "companyId", "locationId", name, email, phone, role, "isActive", "credentialVersion"
                FROM "Staff" WHERE id = (
                    SELECT "staffId" FROM "StaffLoginCode"
                    WHERE phone = ${phone} AND "consumedAt" IS NULL ORDER BY "createdAt" DESC, id DESC LIMIT 1
                ) FOR UPDATE
            `;
            const [row] = await tx.$queryRaw<CodeRow[]>`
                SELECT id, "staffId", "companyId", "codeHash", attempts, "expiresAt"
                FROM "StaffLoginCode"
                WHERE phone = ${phone} AND "consumedAt" IS NULL ORDER BY "createdAt" DESC, id DESC LIMIT 1
                FOR UPDATE
            `;
            const at = now();
            if (!row || row.expiresAt <= at) return codeExpired();
            if (row.attempts >= MAX_ATTEMPTS) {
                await tx.staffLoginCode.update({ where: { id: row.id }, data: { consumedAt: at } });
                return codeLocked();
            }
            if (!staff || staff.id !== row.staffId || staff.companyId !== row.companyId ||
                staff.phone !== phone || !staff.isActive || staff.role !== 'STAFF') {
                await tx.staffLoginCode.update({ where: { id: row.id }, data: { consumedAt: at } });
                return phoneNotRegistered();
            }

            if (!timingSafeEqual(Buffer.from(row.codeHash, 'hex'), hashCode(phone, code))) {
                const attempts = row.attempts + 1;
                const attemptsLeft = MAX_ATTEMPTS - attempts;
                await tx.staffLoginCode.update({
                    where: { id: row.id }, data: { attempts, ...(attemptsLeft === 0 && { consumedAt: at }) },
                });
                if (attemptsLeft === 0) return codeLocked();
                return new ApiError(400, `That code is not right. ${attemptsLeft} tries left.`, [{ code: 'CODE_WRONG', attemptsLeft }]);
            }

            await tx.staffLoginCode.updateMany({ where: { phone, consumedAt: null }, data: { consumedAt: at } });
            const { id, name, email, role, companyId, locationId } = staff;
            const accessToken = generateAccessToken(staff, role);
            const refreshToken = generateRefreshToken(staff, role);
            await tx.staff.update({ where: { id }, data: { refreshToken }, select: { id: true } });
            return { id, name, email, role, companyId, locationId, accessToken, refreshToken };
        }, { isolationLevel: 'ReadCommitted' });

        // Reject after commit so wrong tries and consumed rows stay recorded.
        if (result instanceof ApiError) throw result;
        return result;
    }

    return { requestCode, verifyCode };
}

export const staffLoginCodeService = createStaffLoginCodeService({ prisma, sendSms, now: () => new Date(), randomInt });
