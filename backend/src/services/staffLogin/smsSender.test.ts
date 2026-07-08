import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSmsMessage, createSmsSender, sendSms, SmsUnavailableError, type SmsFailureCategory } from './smsSender.js';

const phone = '+923001234567';
const code = Array.from({ length: 6 }, (_unused, digit) => digit).join('');
const fakeHeaderValue = 'dummy-header-value';
const batchId = 'fake-batch-id';
const expectedMessage = '0 Shumail 1 Shumail 2 Shumail 3 Shumail 4 Shumail 5';
const unsafeDetails = `${fakeHeaderValue} ${phone} ${code}`;

function acceptedResponse() {
    return Response.json({ data: { success: true, smsBatchId: batchId } });
}

function setup() {
    const env: Record<string, string | undefined> = { TEXTBEE_API_KEY: fakeHeaderValue };
    const fetchSms = vi.fn<typeof fetch>().mockResolvedValue(acceptedResponse());
    const abort = new AbortController();
    const timeoutSignal = vi.fn(() => abort.signal);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const send = createSmsSender({ fetch: fetchSms, readEnv: (name) => env[name], timeoutSignal });
    return { env, fetchSms, abort, timeoutSignal, warn, send };
}

async function expectFailure(
    setupResult: Pick<ReturnType<typeof setup>, 'send' | 'fetchSms' | 'warn'>,
    category: SmsFailureCategory,
    status?: number,
) {
    const { send, fetchSms, warn } = setupResult;
    const result: unknown = await send(phone, code).catch((error: unknown) => error);
    expect(result instanceof SmsUnavailableError).toBe(true);
    const error = result as SmsUnavailableError;
    expect(error.category === category).toBe(true);
    expect(error.message === `SMS unavailable: ${category}`).toBe(true);
    expect(error.cause === undefined).toBe(true);
    expect(fetchSms.mock.calls.length).toBe(category === 'NOT_CONFIGURED' ? 0 : 1);
    expect(warn.mock.calls.length).toBe(1);
    const logLine = warn.mock.calls[0][0] as string;
    for (const value of [fakeHeaderValue, phone, code]) {
        expect(error.message.includes(value)).toBe(false);
        expect(logLine.includes(value)).toBe(false);
    }
    expect(logLine === JSON.stringify({ event: 'STAFF_LOGIN_SMS_UNAVAILABLE', providerCode: category, status })).toBe(true);
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('buildSmsMessage', () => {
    it('preserves the leading zero in the exact one-segment ASCII message', () => {
        const message = buildSmsMessage(code);
        expect(message === expectedMessage).toBe(true);
        expect(/^[\x20-\x7e]+$/.test(message)).toBe(true);
        expect(message.length).toBeLessThanOrEqual(160);
    });
});

describe('createSmsSender', () => {
    it.each([undefined, '', '  ', ' device-1 '])('sends one SMS with the optional device (%j)', async (deviceId) => {
        const { env, fetchSms, abort, timeoutSignal, warn, send } = setup();
        env.TEXTBEE_DEVICE_ID = deviceId;

        expect(await send(phone, code)).toEqual({ accepted: true, batchId });
        expect(fetchSms.mock.calls.length).toBe(1);
        const [url, options] = fetchSms.mock.calls[0];
        expect(url).toBe('https://api.textbee.dev/api/v1/gateway/send-sms');
        expect(options?.method).toBe('POST');
        expect(options?.redirect).toBe('error');
        expect(options?.signal).toBe(abort.signal);
        expect(timeoutSignal).toHaveBeenCalledExactlyOnceWith(10_000);
        const headers = new Headers(options?.headers);
        expect(headers.get('x-api-key') === fakeHeaderValue).toBe(true);
        expect(headers.get('content-type')).toBe('application/json');
        expect(options?.body === JSON.stringify({
            recipients: [phone],
            message: expectedMessage,
            ...(deviceId?.trim() && { deviceId: deviceId.trim() }),
        })).toBe(true);
        expect(warn.mock.calls.length).toBe(0);
    });

    it.each([undefined, '', '   '])('does not fetch with a missing or blank key (%j)', async (key) => {
        const sender = setup();
        sender.env.TEXTBEE_API_KEY = key;
        await expectFailure(sender, 'NOT_CONFIGURED');
        expect(sender.timeoutSignal).not.toHaveBeenCalled();
    });

    it.each([
        [401, 'AUTH'],
        [429, 'PLAN_LIMIT'],
        [400, 'REJECTED'],
        [503, 'PROVIDER_ERROR'],
    ] as const)('maps HTTP %i to %s without retrying or leaking details', async (status, category) => {
        const sender = setup();
        const response = Response.json({ message: unsafeDetails }, { status });
        sender.fetchSms.mockResolvedValue(response);
        await expectFailure(sender, category, status);
        expect(response.bodyUsed).toBe(false);
    });

    it.each([
        () => new Response(unsafeDetails),
        () => Response.json(null),
        () => Response.json({ data: { success: false, smsBatchId: batchId, message: unsafeDetails } }),
        () => Response.json({ data: { success: true, message: unsafeDetails } }),
        () => Response.json({ data: { success: 'true', smsBatchId: batchId } }),
        () => Response.json({ data: { success: true, smsBatchId: ' ' } }),
    ])('rejects a non-JSON or malformed HTTP 200 response without leaking details', async (makeResponse) => {
        const sender = setup();
        sender.fetchSms.mockResolvedValue(makeResponse());
        await expectFailure(sender, 'REJECTED', 200);
    });

    it('sanitizes a network error without retrying', async () => {
        const sender = setup();
        sender.fetchSms.mockRejectedValue(new Error(unsafeDetails));
        await expectFailure(sender, 'NETWORK');
    });

    it('classifies the timeout while waiting for a response', async () => {
        const sender = setup();
        sender.fetchSms.mockImplementation(async () => {
            sender.abort.abort(new Error(unsafeDetails));
            sender.abort.signal.throwIfAborted();
            return acceptedResponse();
        });
        await expectFailure(sender, 'TIMEOUT');
    });

    it('classifies the timeout while reading a response body', async () => {
        const sender = setup();
        const response = acceptedResponse();
        vi.spyOn(response, 'json').mockImplementation(async () => {
            sender.abort.abort(new Error(unsafeDetails));
            return response;
        });
        sender.fetchSms.mockResolvedValue(response);
        await expectFailure(sender, 'TIMEOUT', 200);
    });
});

describe('sendSms', () => {
    it('reads the environment on each call instead of at import time', async () => {
        const { fetchSms, warn } = setup();
        vi.stubGlobal('fetch', fetchSms);
        vi.stubEnv('TEXTBEE_API_KEY', '');
        vi.stubEnv('TEXTBEE_DEVICE_ID', '');
        await expectFailure({ send: sendSms, fetchSms, warn }, 'NOT_CONFIGURED');

        vi.stubEnv('TEXTBEE_API_KEY', fakeHeaderValue);
        expect(await sendSms(phone, code)).toEqual({ accepted: true, batchId });
        expect(fetchSms.mock.calls.length).toBe(1);
        expect(warn.mock.calls.length).toBe(1);
    });
});
