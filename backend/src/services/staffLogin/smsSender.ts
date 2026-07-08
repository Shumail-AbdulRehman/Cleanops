import { operationalLog } from '../../utils/operationalLog.js';

const SEND_SMS_URL = 'https://api.textbee.dev/api/v1/gateway/send-sms';
const TIMEOUT_MS = 10_000;

export type SmsFailureCategory =
    | 'NOT_CONFIGURED'
    | 'AUTH'
    | 'PLAN_LIMIT'
    | 'REJECTED'
    | 'PROVIDER_ERROR'
    | 'TIMEOUT'
    | 'NETWORK';

export class SmsUnavailableError extends Error {
    constructor(readonly category: SmsFailureCategory) {
        super(`SMS unavailable: ${category}`);
        this.name = 'SmsUnavailableError';
    }
}

export type SmsSender = (phone: string, code: string) => Promise<{ accepted: true; batchId: string }>;

type SmsSenderDependencies = {
    fetch: typeof fetch;
    readEnv: (name: 'TEXTBEE_API_KEY' | 'TEXTBEE_DEVICE_ID') => string | undefined;
    timeoutSignal: (milliseconds: number) => AbortSignal;
};

export function buildSmsMessage(code: string): string {
    return code.split('').join(' Shumail ');
}

function unavailable(category: SmsFailureCategory, status?: number): never {
    operationalLog({ event: 'STAFF_LOGIN_SMS_UNAVAILABLE', providerCode: category, status }, { level: 'warn' });
    throw new SmsUnavailableError(category);
}

export function createSmsSender(dependencies: SmsSenderDependencies): SmsSender {
    return async (phone, code) => {
        const apiKey = dependencies.readEnv('TEXTBEE_API_KEY')?.trim();
        if (!apiKey) unavailable('NOT_CONFIGURED');

        const deviceId = dependencies.readEnv('TEXTBEE_DEVICE_ID')?.trim();
        const signal = dependencies.timeoutSignal(TIMEOUT_MS);
        let response: Response;
        try {
            response = await dependencies.fetch(SEND_SMS_URL, {
                method: 'POST',
                headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ recipients: [phone], message: buildSmsMessage(code), ...(deviceId && { deviceId }) }),
                redirect: 'error',
                signal,
            });
            signal.throwIfAborted();
        } catch {
            return unavailable(signal.aborted ? 'TIMEOUT' : 'NETWORK');
        }

        const { status } = response;
        if (status === 401) unavailable('AUTH', status);
        if (status === 429) unavailable('PLAN_LIMIT', status);
        if (status >= 500 && status <= 599) unavailable('PROVIDER_ERROR', status);
        if (status !== 200) unavailable('REJECTED', status);

        let payload: { data?: { success?: unknown; smsBatchId?: unknown } | null } | null;
        try {
            payload = await response.json();
            signal.throwIfAborted();
        } catch (error) {
            if (signal.aborted) unavailable('TIMEOUT', status);
            return unavailable(error instanceof SyntaxError ? 'REJECTED' : 'NETWORK', status);
        }

        const batchId = payload?.data?.smsBatchId;
        if (payload?.data?.success !== true || typeof batchId !== 'string' || !batchId.trim()) {
            unavailable('REJECTED', status);
        }
        return { accepted: true, batchId };
    };
}

const textbeeSender = createSmsSender({
    fetch: (input, options) => fetch(input, options),
    readEnv: (name) => process.env[name],
    timeoutSignal: (milliseconds) => AbortSignal.timeout(milliseconds),
});

/** Local phone testing only (project copy): write the code to var/staff-login-codes.log instead of sending an SMS. */
export const sendSms: SmsSender = async (phone, code) => {
    if (process.env.STAFF_LOGIN_LOCAL_CODES === 'true' && process.env.NODE_ENV !== 'production') {
        const { appendFile, mkdir } = await import('node:fs/promises');
        await mkdir('var', { recursive: true });
        await appendFile('var/staff-login-codes.log', `${new Date().toISOString()} ${phone} ${code}\n`);
        console.log(`[local] staff sign-in code for ${phone}: ${code}`);
        return { accepted: true, batchId: 'local-' + Date.now() };
    }
    return textbeeSender(phone, code);
};
