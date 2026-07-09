type LogLevel = 'error' | 'warn';
export type OperationalLogSink = (line: string, level: LogLevel) => void;

/** Only identifiers and transport facts belong here, never free-form text. */
export type OperationalLogFields = {
    event: string;
    route?: unknown;
    method?: unknown;
    status?: unknown;
    errorClass?: unknown;
    providerCode?: unknown;
    providerType?: unknown;
    companyId?: unknown;
    reservationId?: unknown;
};

type LogContext = { level?: LogLevel; requestId?: string };
const identifier = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createOperationalLogger(
    sink: OperationalLogSink = (line, level) => console[level](line),
) {
    return (fields: OperationalLogFields, context: LogContext = {}): void => {
        const record: Record<string, string | number> = {};
        // Copy individually: spreading/serializing the input could expose payloads
        // or invoke an Error's or provider object's toJSON method.
        if (typeof fields.event === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(fields.event)) {
            record.event = fields.event;
        } else {
            record.event = 'INVALID_LOG_EVENT';
        }
        for (const key of ['errorClass', 'providerCode', 'providerType'] as const) {
            const value = fields[key];
            if (typeof value === 'string' && identifier.test(value)) record[key] = value;
        }
        // Callers supply Express route templates, never URLs, query strings or bodies.
        if (typeof fields.route === 'string' && fields.route.length <= 200 &&
            /^\/[A-Za-z0-9_/:{}*.-]*$/.test(fields.route)) record.route = fields.route;
        if (typeof fields.method === 'string' &&
            /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|CONNECT|TRACE)$/.test(fields.method)) {
            record.method = fields.method;
        }
        if (typeof fields.status === 'number' && Number.isInteger(fields.status) &&
            fields.status >= 100 && fields.status <= 599) record.status = fields.status;
        for (const key of ['companyId', 'reservationId'] as const) {
            const value = fields[key];
            if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) record[key] = value;
        }
        // Correlation metadata is supplied separately by the server, not copied
        // from arbitrary error/request fields or the incoming X-Request-Id header.
        if (typeof context.requestId === 'string' && uuid.test(context.requestId)) {
            record.requestId = context.requestId;
        }
        sink(JSON.stringify(record), context.level === 'warn' ? 'warn' : 'error');
    };
}

export const operationalLog = createOperationalLogger();

/** Extract classification only. Never pass the error itself to a log sink. */
export function operationalErrorFields(error: unknown): Pick<OperationalLogFields, 'errorClass' | 'providerCode' | 'providerType'> {
    const details = error !== null && typeof error === 'object' ? error as { code?: unknown; type?: unknown } : {};
    return {
        errorClass: error instanceof Error ? error.constructor.name : 'NonError',
        providerCode: details.code,
        providerType: details.type,
    };
}
