import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { approvedLink, getPublicSupport, serviceInformation } from './serviceInformation';

const request = vi.fn();
const contact = (data: Record<string, unknown>) => request.mockResolvedValue({ ok: true, json: async () => ({ data }) });

beforeEach(() => { vi.stubGlobal('fetch', request); request.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('public contact request omits credentials', async () => {
  contact({ available: false, email: null, channel: null, verification: 'UNAVAILABLE' });
  await getPublicSupport();
  expect(request).toHaveBeenCalledWith('/api/support/contact', expect.objectContaining({ credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) }));
});
it('returns an operator-configured support email', async () => {
  contact({ available: true, email: 'support@example.invalid', channel: 'EMAIL', verification: 'OPERATOR_CONFIGURED' });
  await expect(getPublicSupport()).resolves.toEqual({ email: 'support@example.invalid' });
});
it.each([
  ['UNAVAILABLE', 'support@example.invalid'],
  ['OPERATOR_CONFIGURED', 'support@example.invalid?bcc=other'],
])('does not return an unqualified channel or invalid mailbox: %s', async (verification, email) => {
  contact({ available: true, email, channel: 'EMAIL', verification });
  await expect(getPublicSupport()).resolves.toEqual({ email: null });
});
it.each(['javascript:alert(1)', 'http://approved.example.invalid/terms', 'https://approved.example.invalid.evil.invalid/terms', 'https://name:password@approved.example.invalid/terms', 'https://approved.example.invalid/terms?token=secret', '//approved.example.invalid/terms', 'https://approved.example.invalid/terms#token'])('rejects unsafe or unexpected link %s', raw => {
  expect(approvedLink(raw, 'https://approved.example.invalid', 'true')).toBeNull();
});
it('a URL without explicit approval cannot enable policy availability', () => {
  expect(approvedLink('https://approved.example.invalid/terms', 'https://approved.example.invalid', undefined)).toBeNull();
  expect(serviceInformation({ VITE_SERVICE_TERMS_URL: 'https://approved.example.invalid/terms' }).policiesReady).toBe(false);
});

function stalledContact() {
  request.mockImplementation((_url, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  }));
}
it('a stalled contact request ends after the timeout', async () => {
  vi.useFakeTimers(); stalledContact();
  const failure = expect(getPublicSupport()).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(10_000); await failure;
  expect(request.mock.calls[0][1].signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it.each(['before', 'during'])('caller cancellation %s the request aborts fetch and releases the timeout', async when => {
  vi.useFakeTimers(); stalledContact();
  const controller = new AbortController();
  if (when === 'before') controller.abort();
  const failure = expect(getPublicSupport(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  if (when === 'during') controller.abort();
  await failure;
  expect(request.mock.calls[0][1].signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
