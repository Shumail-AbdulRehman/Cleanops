import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOperationalLogger, operationalErrorFields } from './operationalLog.js';

const requestId = '12345678-1234-4234-8234-123456789abc';
afterEach(() => vi.restoreAllMocks());

describe('operational logging', () => {
    it('writes only the allowed transport/identifier fields and server correlation metadata', () => {
        const sink = vi.fn();
        const log = createOperationalLogger(sink);
        const fields = {
            event: 'PROVIDER_REQUEST_FAILED', route: '/checkout/:id', method: 'POST', status: 503,
            errorClass: 'ApiError', providerCode: 'customer_email_conflict', providerType: 'request_error',
            companyId: 7, reservationId: 42,
        };
        log(fields, { requestId });
        expect(sink).toHaveBeenCalledExactlyOnceWith(expect.any(String), 'error');
        expect(JSON.parse(sink.mock.calls[0]![0])).toEqual({ ...fields, requestId });
    });

    it('drops messages, emails, names, tokens, card data, SQL, payloads and every unknown field before the sink', () => {
        const sink = vi.fn();
        const toJSON = vi.fn(() => ({ token: 'private-token' }));
        const error = Object.assign(new Error('owner@example.invalid token=private-token SELECT * FROM Company'), {
            event: 'UNEXPECTED_REQUEST_ERROR', email: 'owner@example.invalid', name: 'Private Owner',
            token: 'private-token', sql: 'SELECT * FROM Company', headers: { authorization: 'Bearer private-token' },
            body: { card: '4242424242424242' }, payload: { email: 'owner@example.invalid' },
            requestId: 'caller-controlled', toJSON,
        });
        createOperationalLogger(sink)(error);
        expect(sink).toHaveBeenCalledExactlyOnceWith('{"event":"UNEXPECTED_REQUEST_ERROR"}', 'error');
        expect(toJSON).not.toHaveBeenCalled();
    });

    it('rejects free text and credential-bearing values even in allowed fields', () => {
        const sink = vi.fn();
        createOperationalLogger(sink)({
            event: 'owner@example.invalid', route: '/checkout?token=private-token', method: 'POST private-token',
            status: '500', errorClass: 'SELECT * FROM Company', providerCode: 'owner@example.invalid',
            providerType: 'eyJhbGciOiJIUzI1NiJ9.private-token.signature',
            companyId: { email: 'owner@example.invalid' }, reservationId: 'private-token',
        }, { requestId: 'private-token' });
        expect(sink).toHaveBeenCalledExactlyOnceWith('{"event":"INVALID_LOG_EVENT"}', 'error');
    });

    it.each([
        { status: 99 }, { status: 600 }, { status: 500.5 }, { status: NaN },
        { companyId: 0 }, { companyId: -1 }, { companyId: Number.MAX_SAFE_INTEGER + 1 },
        { reservationId: '42' }, { reservationId: 1.5 }, { route: /private/ },
        { route: '/owner@example.invalid' }, { route: '/' + 'a'.repeat(201) },
        { providerCode: { toJSON: () => 'private-token' } }, { providerType: 'x'.repeat(81) },
    ])('drops invalid field values %j', fields => {
        const sink = vi.fn();
        createOperationalLogger(sink)({ event: 'SAFE_EVENT', ...fields });
        expect(sink).toHaveBeenCalledExactlyOnceWith('{"event":"SAFE_EVENT"}', 'error');
    });

    it('does not stringify nested errors or arbitrary objects', () => {
        const sink = vi.fn();
        const toJSON = vi.fn(() => { throw new Error('must not execute'); });
        const value = { toJSON };
        createOperationalLogger(sink)({ event: 'SAFE_EVENT', errorClass: value, providerCode: value,
            providerType: value, companyId: value, reservationId: value, route: value, method: value, status: value });
        expect(sink).toHaveBeenCalledExactlyOnceWith('{"event":"SAFE_EVENT"}', 'error');
        expect(toJSON).not.toHaveBeenCalled();
    });

    it('sends a warning to the warning sink without adding unapproved context fields', () => {
        const sink = vi.fn();
        const context = { level: 'warn' as const, message: 'owner@example.invalid', requestId };
        createOperationalLogger(sink)({ event: 'INVALID_TRUST_PROXY_HOPS' }, context);
        expect(sink).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: 'INVALID_TRUST_PROXY_HOPS', requestId }), 'warn');
    });

    it('uses the matching console sink by default with serialized safe records only', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const log = createOperationalLogger();
        log({ event: 'SAFE_ERROR' });
        log({ event: 'SAFE_WARNING' }, { level: 'warn' });
        expect(error).toHaveBeenCalledExactlyOnceWith('{"event":"SAFE_ERROR"}');
        expect(warn).toHaveBeenCalledExactlyOnceWith('{"event":"SAFE_WARNING"}');
    });

    it('extracts the error class and Prisma/provider identifiers without copying the message or metadata', () => {
        class PrismaClientKnownRequestError extends Error {}
        const error = Object.assign(new PrismaClientKnownRequestError('private SQL owner@example.invalid'), {
            code: 'P1001', meta: { token: 'private-token' }, clientVersion: 'private-version',
        });
        const sink = vi.fn();
        createOperationalLogger(sink)({ event: 'UNEXPECTED_REQUEST_ERROR', ...operationalErrorFields(error) });
        expect(JSON.parse(sink.mock.calls[0]![0])).toEqual({
            event: 'UNEXPECTED_REQUEST_ERROR', errorClass: 'PrismaClientKnownRequestError', providerCode: 'P1001',
        });
    });

    it.each([null, undefined, 'owner@example.invalid private-token', 123, { code: 'request_error', type: 'api_error', message: 'private' }])(
        'classifies non-Error throws without serializing them (%j)', error => {
            const sink = vi.fn();
            createOperationalLogger(sink)({ event: 'UNEXPECTED_REQUEST_ERROR', ...operationalErrorFields(error) });
            const record = JSON.parse(sink.mock.calls[0]![0]);
            expect(record).toEqual(error && typeof error === 'object'
                ? { event: 'UNEXPECTED_REQUEST_ERROR', errorClass: 'NonError', providerCode: 'request_error', providerType: 'api_error' }
                : { event: 'UNEXPECTED_REQUEST_ERROR', errorClass: 'NonError' });
        },
    );
});
