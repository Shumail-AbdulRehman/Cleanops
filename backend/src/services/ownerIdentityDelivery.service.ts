import { z } from 'zod';
import { ApiError } from '../utils/ApiError.js';
export type OwnerPurpose = 'VERIFY_OWNER_EMAIL' | 'RESET_OWNER_PASSWORD';
export type OwnerMessage = { purpose: OwnerPurpose; to: string; token: string; operationId: string };
export type OwnerDelivery = (message: OwnerMessage) => Promise<void>;
const unavailable = () => new ApiError(503, 'Owner email delivery is unavailable');

/** Explicit opt-in only. Provider acceptance never asserts recipient delivery. */
export function configuredOwnerDelivery(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): OwnerDelivery {
    const key = env.OWNER_IDENTITY_RESEND_API_KEY, sender = env.OWNER_IDENTITY_SENDER_EMAIL;
    let origin: URL;
    try { origin = new URL(env.OWNER_IDENTITY_WEB_ORIGIN ?? ''); } catch { throw unavailable(); }
    if (env.OWNER_IDENTITY_MAIL_ENABLED !== 'true' || env.OWNER_IDENTITY_MAIL_PROVIDER !== 'resend' ||
        env.OWNER_IDENTITY_SENDER_VERIFIED !== 'true' || !sender || !z.email().safeParse(sender).success || sender.length > 254 ||
        !key || key.length < 24 || key.length > 256 || /\s|changeme|placeholder|your[_-]/i.test(key) ||
        origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw unavailable();
    return async message => {
        try {
            if (!z.email().safeParse(message.to).success || !/^[A-Za-z0-9_-]{43}$/.test(message.token) ||
                !z.uuid().safeParse(message.operationId).success || !['VERIFY_OWNER_EMAIL', 'RESET_OWNER_PASSWORD'].includes(message.purpose)) throw unavailable();
            const verify = message.purpose === 'VERIFY_OWNER_EMAIL';
            const url = new URL(verify ? '/verify-owner-email' : '/reset-owner-password', origin);
            url.hash = `token=${encodeURIComponent(message.token)}`;
            const response = await fetcher('https://api.resend.com/emails', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
                headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `owner-identity/${message.operationId}` },
                body: JSON.stringify({ from: sender, to: [message.to], subject: verify ? 'Verify your Hygene Ops owner email' : 'Reset your Hygene Ops owner password',
                    text: `${verify ? 'Verify your email' : 'Reset your password'} using this one-use link. It expires in ${verify ? '24 hours' : '30 minutes'}.\n\n${url}\n\nIf you did not request this, ignore this email. No password or account status has been changed.` }) });
            if (!response.ok || !response.body) { await response.body?.cancel(); throw unavailable(); }
            const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
            try {
                for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 8192) throw unavailable(); chunks.push(part.value); }
                const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                if (!z.object({ id: z.uuid() }).safeParse(parsed).success) throw unavailable();
            } finally { await reader.cancel().catch(() => undefined); }
        } catch { throw unavailable(); }
    };
}
