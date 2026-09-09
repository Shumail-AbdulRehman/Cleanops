/** Client deadlines in milliseconds; no global Axios defaults are changed. */
export const BILLING_REQUEST_LIMITS = {
  read: 15_000,
  confirm: 20_000,
  reconcile: 30_000,
  prepare: 45_000,
} as const;

export type BillingRequestFailure = 'not_sent' | 'timed_out_after_send' | 'server' | 'offline';

export class BillingRequestError extends Error {
  readonly kind: BillingRequestFailure;
  readonly sent: boolean;
  readonly status: number | null;
  readonly code: string | null;
  readonly response?: { status: number; data: { code: string | null } };

  constructor(
    kind: BillingRequestFailure,
    sent: boolean,
    status: number | null = null,
    code: string | null = null,
  ) {
    super(kind === 'server' ? 'Billing request failed' :
      kind === 'offline' ? 'Billing connection unavailable' :
      kind === 'not_sent' ? 'Billing request was not sent' : 'Billing request outcome is unknown');
    this.name = 'BillingRequestError';
    this.kind = kind;
    this.sent = sent;
    this.status = status;
    this.code = code;
    if (status !== null) this.response = { status, data: { code } };
  }
}

/**
 * Dispatch is a conservative boundary: once handed to the shared client, a
 * cancellation cannot prove that the server did not process the operation.
 * Race explicitly, since an adapter may ignore its abort signal entirely.
 */
export async function billingRequest<T>(
  request: (signal: AbortSignal) => Promise<T>,
  limit: number,
  callerSignal?: AbortSignal,
): Promise<T> {
  if (callerSignal?.aborted) throw new BillingRequestError('not_sent', false);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new BillingRequestError('offline', false);
  }
  const controller = new AbortController();
  let sent = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => {
      const error = new BillingRequestError(sent ? 'timed_out_after_send' : 'not_sent', sent);
      // Reject first so an adapter's cancellation cannot replace this outcome.
      reject(error);
      controller.abort(error);
    };
    callerSignal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(onAbort, limit);
  });
  try {
    // Normalize synchronous adapter throws before attaching both race handlers.
    const pending = new Promise<T>(resolve => {
      sent = true;
      resolve(request(controller.signal));
    });
    const response = await Promise.race([interrupted, pending]);
    if (controller.signal.aborted) throw controller.signal.reason;
    return response;
  } catch (cause) {
    if (controller.signal.aborted) throw controller.signal.reason;
    const error = cause as { response?: { status?: unknown; data?: { code?: unknown } }; code?: unknown } | null;
    const status = error?.response?.status;
    if (typeof status === 'number') {
      const code = error?.response?.data?.code;
      throw new BillingRequestError('server', sent, status, typeof code === 'string' ? code : null);
    }
    if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') {
      throw new BillingRequestError('timed_out_after_send', sent);
    }
    throw new BillingRequestError('offline', sent);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onAbort);
  }
}
