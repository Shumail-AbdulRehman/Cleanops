import type { QueryClient } from '@tanstack/react-query';

/** Separate from tenant identity, cookies, refresh interceptors and query keys. */
export const operatorQueryScope = ['platform-operator'] as const;
export const operatorSessionStatus = Object.freeze({
  status: 'unavailable' as const,
  reason: 'PROVIDER_HANDOFF_NOT_QUALIFIED' as const,
});

export class OperatorUnavailableError extends Error {
  readonly code = 'OPERATOR_SIGN_IN_UNAVAILABLE';
  constructor() {
    super('Platform sign-in is unavailable');
    this.name = 'OperatorUnavailableError';
  }
}

/** Local cleanup only: it cannot claim to revoke an unconfigured IdP session. */
export async function clearOperatorSession(queryClient: QueryClient): Promise<void> {
  try {
    await queryClient.cancelQueries({ queryKey: operatorQueryScope });
  } finally {
    queryClient.removeQueries({ queryKey: operatorQueryScope });
  }
}

/** There is no initiated flow whose state, nonce or PKCE can be verified. */
export function rejectOperatorCallback(): 'UNEXPECTED_CALLBACK' {
  // Never decode, persist or promote URL tokens/claims into an operator identity.
  return 'UNEXPECTED_CALLBACK';
}

/** Explicit local build only; never use tenant state as platform authority. */
export function localOperatorLoginEnabled() {
  return import.meta.env.VITE_LOCAL_PLATFORM_LOGIN === 'true'
    && ['localhost','127.0.0.1','[::1]'].includes(window.location.hostname);
}
const localSessionKey = [...operatorQueryScope, 'local-session'];
export { localSessionKey };

function operatorTarget(path: string, local: boolean) {
  const origin = window.location.origin;
  const suffix = '/' + path.replace(/^\//, '');
  if (local) {
    const base = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '') || '/api';
    const target = new URL(base + suffix, origin);
    if (['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) return target;
  } else {
    // Live mode always stays on this site's own /api path, which the host forwards to the API
    // (frontend/public/_redirects), even when tenant pages call the API origin directly.
    // The operator cookie is SameSite=Strict, so it only works same-origin.
    try {
      const target = new URL('/api' + suffix, origin);
      if (target.origin === origin && target.pathname.startsWith('/api/')) return target;
    } catch { /* Invalid paths are unavailable. */ }
  }
  throw new OperatorUnavailableError();
}

/** Cookie transport shared by the operator session and console APIs. */
export async function operatorRequest<T>(
  path: string,
  options?: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown; signal?: AbortSignal },
): Promise<T> {
  const local = localOperatorLoginEnabled();
  const target = operatorTarget(path, local);
  const body = options?.body === undefined ? undefined : JSON.stringify(options.body);
  const response = await fetch(target.toString(), {
    method: options?.method ?? 'GET',
    credentials: 'include',
    cache: 'no-store',
    ...(local ? {} : { redirect: 'error' }),
    signal: options?.signal,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body,
  });
  if (!response.ok) {
    const error = Object.assign(new Error('Platform request failed'),{status:response.status});
    throw error;
  }
  return response.json() as Promise<T>;
}
export async function getLocalOperatorSession({ signal }: { signal?: AbortSignal } = {}) {
  return (await operatorRequest<{data:{enabled:boolean;authenticated:boolean;email?:string}}>('/platform/session', { signal })).data;
}
export async function signInLocalOperator(email:string,password:string) {
  return (await operatorRequest<{data:{authenticated:boolean;email:string}}>('/platform/session/login',{method:'POST',body:{email,password}})).data;
}
export async function signOutLocalOperator() {
  await operatorRequest('/platform/session/logout',{method:'POST'});
}
