import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { client, isSessionInvalid } from './client';
import { store } from '@/store/store';
import { clearUser, setUser } from '@/store/slices/authSlice';

const owner = { id: 7, companyId: 42, role: 'ADMIN' as const, name: 'Fixture', email: 'fixture@example.invalid' };
const currentUser = '/common/get-current-user';
const refresh = '/common/refresh-token';
const defaultAdapter = client.defaults.adapter;
function reply(config: InternalAxiosRequestConfig, data: unknown = { data: owner }): AxiosResponse {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}
function fail(config: InternalAxiosRequestConfig, status: number, data: unknown = {}): never {
  throw new AxiosError('Synthetic failure', 'ERR_BAD_RESPONSE', config, undefined, { ...reply(config, data), status });
}
function expired(config: InternalAxiosRequestConfig): never { return fail(config, 401, { message: 'Access Token Expired' }); }
function useAdapter(adapter: AxiosAdapter) {
  const spy = vi.fn(adapter);
  client.defaults.adapter = spy;
  return spy;
}
beforeEach(() => { store.dispatch(setUser(owner)); });
afterEach(() => { client.defaults.adapter = defaultAdapter; store.dispatch(clearUser()); });

it.each([
  [undefined, false], [new Error('offline'), false],
  [{ response: { status: 503 } }, false], [{ response: { status: 401 } }, true],
  [{ response: { status: 403 } }, false],
  [{ response: { status: 403, data: { message: 'Account is deactivated' } } }, true],
  [{ response: { status: 403, data: { errors: [{ code: 'SESSION_REVOKED' }] } } } , true],
  [{ response: { status: 403, data: { errors: [{ code: 'ACCOUNT_SUSPENDED' }] } } }, false],
  [{ response: { status: 403, data: { errors: [{ code: 'PASSWORD_CHANGE_REQUIRED' }] } } }, false],
])('classifies only confirmed session rejection: %#', (error, invalid) => {
  expect(isSessionInvalid(error)).toBe(invalid);
});

it.each([401, 503, 'network'] as const)('recovers one current-user read after a lost %s refresh without signing out', async failure => {
  let reads = 0;
  const adapter = useAdapter(async config => {
    if (config.url === refresh) {
      if (failure === 'network') throw new AxiosError('Lost reply', 'ERR_NETWORK', config);
      return fail(config, failure);
    }
    if (++reads === 1) return expired(config);
    return reply(config);
  });
  const dispatch = vi.spyOn(store, 'dispatch');
  const result = await client.get(currentUser);
  expect(result.data).toEqual({ data: owner });
  expect(adapter.mock.calls.map(([config]) => config.url)).toEqual([currentUser, refresh, currentUser]);
  expect(store.getState().auth.user).toEqual(owner);
  expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'auth/clearUser' }));
});
it('shares one refresh and recovery read between concurrent expired requests', async () => {
  let release!: () => void;
  const refreshFinished = new Promise<void>(resolve => { release = resolve; });
  const counts = new Map<string, number>();
  const adapter = useAdapter(async config => {
    const url = config.url!;
    const count = (counts.get(url) ?? 0) + 1;
    counts.set(url, count);
    if (url === refresh) { await refreshFinished; return fail(config, 401); }
    if (url === currentUser) return reply(config);
    if (count === 1) return expired(config);
    return reply(config, { url });
  });
  const pending = Promise.all(['/tasks', '/locations', '/shifts'].map(url => client.get(url)));
  await vi.waitFor(() => expect(counts.get(refresh)).toBe(1));
  release();
  expect((await pending).map(result => result.data.url)).toEqual(['/tasks', '/locations', '/shifts']);
  expect(counts.get(currentUser)).toBe(1);
  expect(counts.get(refresh)).toBe(1);
  expect(adapter).toHaveBeenCalledTimes(8);
  expect(store.getState().auth.user).toEqual(owner);
});
it('retries the original request once after an ordinary successful refresh', async () => {
  let reads = 0;
  const adapter = useAdapter(async config => {
    if (config.url === refresh) return reply(config, {});
    if (++reads === 1) return expired(config);
    return reply(config);
  });
  expect((await client.get(currentUser)).data).toEqual({ data: owner });
  expect(adapter.mock.calls.map(([config]) => config.url)).toEqual([currentUser, refresh, currentUser]);
});
it.each([
  { status: 401 },
  { status: 403, data: { message: 'Account is deactivated' } },
  { status: 403, data: { errors: [{ code: 'SESSION_REVOKED' }] } },
])('signs out only after the recovery read confirms rejection: %j', async rejection => {
  let reads = 0;
  const adapter = useAdapter(async config => {
    if (config.url === refresh) return fail(config, 401);
    if (++reads === 1) return expired(config);
    return fail(config, rejection.status, rejection.data);
  });
  await expect(client.get(currentUser)).rejects.toMatchObject({ response: rejection });
  expect(adapter).toHaveBeenCalledTimes(3);
  expect(store.getState().auth.user).toBeNull();
});
it.each([
  { status: 503 }, { status: 500 },
  { status: 403, data: { errors: [{ code: 'ACCOUNT_SUSPENDED' }] } },
  { status: 403, data: { errors: [{ code: 'PASSWORD_CHANGE_REQUIRED' }] } },
  { status: 403 }, 'network',
])('preserves auth and forwards the recovery read failure after a rejected refresh: %j', async rejection => {
  let reads = 0;
  const adapter = useAdapter(async config => {
    if (config.url === refresh) return fail(config, 401);
    if (++reads === 1) return expired(config);
    if (typeof rejection === 'string') throw new AxiosError('offline', 'ERR_NETWORK', config);
    return fail(config, rejection.status, rejection.data);
  });
  const dispatch = vi.spyOn(store, 'dispatch');
  await expect(client.get(currentUser)).rejects.toMatchObject(rejection === 'network' ? { code: 'ERR_NETWORK' } : { response: rejection });
  expect(adapter).toHaveBeenCalledTimes(3);
  expect(store.getState().auth.user).toEqual(owner);
  expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'auth/clearUser' }));
});
it('does not start a second refresh when the recovery read also has an expired token', async () => {
  const adapter = useAdapter(async config => config.url === refresh ? fail(config, 401) : expired(config));
  await expect(client.get(currentUser)).rejects.toMatchObject({ response: { status: 401 } });
  expect(adapter.mock.calls.map(([config]) => config.url)).toEqual([currentUser, refresh, currentUser]);
  expect(store.getState().auth.user).toBeNull();
});
it('bounds replay to one attempt when refresh succeeds but the original request remains expired', async () => {
  const adapter = useAdapter(async config => config.url === refresh ? reply(config, {}) : expired(config));
  await expect(client.get('/tasks')).rejects.toMatchObject({ response: { status: 401 } });
  expect(adapter.mock.calls.map(([config]) => config.url)).toEqual(['/tasks', refresh, '/tasks']);
});
it('clears the shared promise after failure so a later request can recover', async () => {
  let reads = 0;
  const adapter = useAdapter(async config => {
    if (config.url === refresh) return fail(config, 401);
    reads++;
    if (reads === 1 || reads === 3) return expired(config);
    if (reads === 2) return fail(config, 503);
    return reply(config);
  });
  await expect(client.get(currentUser)).rejects.toMatchObject({ response: { status: 503 } });
  expect((await client.get(currentUser)).data).toEqual({ data: owner });
  expect(adapter.mock.calls.map(([config]) => config.url)).toEqual([currentUser, refresh, currentUser, currentUser, refresh, currentUser]);
  expect(store.getState().auth.user).toEqual(owner);
});
it.each([401, 403, 503])('does not refresh an unrelated %s error or clear a session', async status => {
  const adapter = useAdapter(async config => fail(config, status, { message: 'Unrelated failure' }));
  await expect(client.get('/tasks')).rejects.toMatchObject({ response: { status } });
  expect(adapter).toHaveBeenCalledOnce();
  expect(store.getState().auth.user).toEqual(owner);
});
it('does not clear auth merely because a direct refresh call fails', async () => {
  const adapter = useAdapter(async config => fail(config, 503));
  await expect(client.post(refresh)).rejects.toMatchObject({ response: { status: 503 } });
  expect(adapter).toHaveBeenCalledOnce();
  expect(store.getState().auth.user).toEqual(owner);
});
it('propagates errors that have no request configuration', async () => {
  useAdapter(async () => { throw new Error('No config'); });
  await expect(client.get('/tasks')).rejects.toThrow('No config');
  expect(store.getState().auth.user).toEqual(owner);
});
it('preserves multipart handling and credentialed requests', async () => {
  const adapter = useAdapter(async config => reply(config));
  const form = new FormData();
  form.append('fixture', 'synthetic');
  await client.post('/upload', form);
  const config = adapter.mock.calls[0][0];
  expect(config.data).toBe(form);
  expect(config.headers.get('Content-Type')).not.toBe('application/json');
  expect(config.withCredentials).toBe(true);
});
