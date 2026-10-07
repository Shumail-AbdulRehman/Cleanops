import axios, { AxiosHeaders, InternalAxiosRequestConfig } from "axios";
import { getServerAddress, loadServerAddress, saveServerAddress } from './serverAddress';
import type { AuthTokens } from "../types";

type ApiAuthBridge = {
  getScope: () => string | null;
  getTokens: () => Promise<AuthTokens>;
  setTokens: (tokens: Required<AuthTokens>) => Promise<void>;
  clearSession: () => Promise<void>;
};

let authBridge: ApiAuthBridge | null = null;
let nativeAppVersion='0.0.0';
export function configureNativeAppVersion(version:string|null){nativeAppVersion=version??'0.0.0';client.defaults.headers.common['X-Hygene-App-Version']=nativeAppVersion;client.defaults.headers['X-Hygene-App-Version']=nativeAppVersion;}

export const configureApiAuth = (bridge: ApiAuthBridge) => {
  authBridge = bridge;
};

export async function changeApiServerAddress(input: string): Promise<string> {
  if (authBridge?.getScope()) throw new Error('Sign out before changing the server address.');
  return saveServerAddress(input);
}

const isFormData = (value: unknown): value is FormData =>
  typeof FormData !== "undefined" && value instanceof FormData;

export const staffSignInPaths = {
  request: '/common/staff-login/request-code',
  verify: '/common/staff-login/verify-code',
} as const;

const isLoginRequest = (url?: string) =>
  Object.values(staffSignInPaths).some(path => url?.split('?')[0].replace(/\/+$/, '').endsWith(path) === true);

const setHeader = (
  config: InternalAxiosRequestConfig,
  key: string,
  value: string | null
) => {
  if (!value) {
    return;
  }

  if (config.headers instanceof AxiosHeaders) {
    config.headers.set(key, value);
    return;
  }

  const headers = AxiosHeaders.from(config.headers);
  headers.set(key, value);
  config.headers = headers;
};

const removeHeader = (config: InternalAxiosRequestConfig, key: string) => {
  if (config.headers instanceof AxiosHeaders) {
    config.headers.delete(key);
    return;
  }

  if (!config.headers) {
    return;
  }

  const headers = AxiosHeaders.from(config.headers);
  headers.delete(key);
  config.headers = headers;
};

export const accountRequest = (scope: string) => ({ _scope: scope } as import('axios').AxiosRequestConfig & { _scope: string });

export const client = axios.create({
  baseURL: getServerAddress(),
  timeout: 20000,
  headers:{"X-Hygene-Workflow":"2","X-Hygene-App-Version":nativeAppVersion},
});

client.interceptors.request.use(async (config) => {
  await loadServerAddress();
  config.baseURL = getServerAddress();
  const request = config as InternalAxiosRequestConfig & { _scope?: string | null };
  const scope = authBridge?.getScope() ?? null;
  if (request._scope !== undefined && request._scope !== scope) throw new Error('Account changed. Request stopped.');
  request._scope = scope;
  const tokens = await authBridge?.getTokens();
  if (request._scope !== (authBridge?.getScope() ?? null)) throw new Error('Account changed. Request stopped.');
  // Use the actual native version even when a queued/retried request retains
  // headers created before App initialized its version.
  setHeader(config, 'X-Hygene-Workflow', '2');
  setHeader(config, 'X-Hygene-App-Version', nativeAppVersion);

  if (isLoginRequest(config.url)) {
    removeHeader(config, "Authorization");
  } else if (tokens?.accessToken) {
    setHeader(config, "Authorization", `Bearer ${tokens.accessToken}`);
  }

  if (isFormData(config.data)) {
    removeHeader(config, "Content-Type");
  } else if (!AxiosHeaders.from(config.headers).has("Content-Type")) {
    setHeader(config, "Content-Type", "application/json");
  }

  return config;
});

let refreshInFlight: { scope: string | null; promise: Promise<Required<AuthTokens>> } | null = null;
export const refreshApiTokens = (): Promise<Required<AuthTokens>> => {
  const scope = authBridge?.getScope() ?? null;
  if (refreshInFlight?.scope === scope) return refreshInFlight.promise;
  const promise = (async () => {
    if (!authBridge) throw new Error("Sign in again to upload photos.");
    const bridge = authBridge;
    const tokens = await bridge.getTokens();
    if (!tokens.refreshToken) throw new Error("Sign in again to upload photos.");
    try {
      await loadServerAddress();
      const response = await axios.post(`${getServerAddress()}/common/refresh-token`, { refreshToken: tokens.refreshToken }, { timeout: 20000 });
      const nextTokens = { accessToken: response.data.data.accessToken as string, refreshToken: response.data.data.refreshToken as string };
      if (bridge.getScope() !== scope || (await bridge.getTokens()).refreshToken !== tokens.refreshToken) throw new Error("Account changed during token refresh.");
      await bridge.setTokens(nextTokens);
      return nextTokens;
    } catch (error) {
      if (axios.isAxiosError(error) && [401,403].includes(error.response?.status ?? 0)
        && (await bridge.getTokens()).refreshToken === tokens.refreshToken) await bridge.clearSession();
      throw error;
    }
  })().finally(() => { if (refreshInFlight?.promise === promise) refreshInFlight = null; });
  refreshInFlight = { scope, promise };
  return promise;
};
client.interceptors.response.use(response => {
  if ((response.config as InternalAxiosRequestConfig & {_scope?:string|null})._scope !== (authBridge?.getScope()??null)) {
    throw new Error('Account changed. Response stopped.');
  }
  return response;
}, async error => {
  const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
  if (original && '_scope' in original && original._scope !== (authBridge?.getScope()??null)) {
    throw new Error('Account changed. Response stopped.');
  }
  if (!original || error.response?.status !== 401 || original._retry || isLoginRequest(original.url) || original.url?.includes("/common/refresh-token")) throw error;
  original._retry = true;
  if ((original as typeof original & {_scope?:string|null})._scope !== (authBridge?.getScope()??null)) throw new Error('Account changed. Request stopped.');
  const current=await authBridge?.getTokens();
  const tokens=current?.accessToken && AxiosHeaders.from(original.headers).get('Authorization')!==`Bearer ${current.accessToken}` ? current : await refreshApiTokens();
  setHeader(original, "Authorization", `Bearer ${tokens.accessToken}`);
  return client(original);
});

type UploadResponse = { status: number; ok: boolean; json: () => Promise<any>; headers: { get: (name: string) => string | null } };

/**
 * The same POST through XMLHttpRequest, which (unlike React Native's fetch) reports the bytes sent (spec 72).
 * Answers like fetch: a network failure rejects with a TypeError, an abort with an `AbortError`.
 */
function postWithProgress(url: string, headers: Record<string, string>, body: FormData, signal: AbortSignal, onProgress: (fraction: number) => void): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const settle = () => signal.removeEventListener("abort", abort);
    xhr.open("POST", url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = event => {
      if (!event.lengthComputable || !(event.total > 0)) return;
      try { onProgress(Math.min(1, Math.max(0, event.loaded / event.total))); } catch { /* Progress is display only. */ }
    };
    xhr.onload = () => {
      settle();
      const text = xhr.responseText;
      resolve({ status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300, json: async () => JSON.parse(text), headers: { get: name => xhr.getResponseHeader(name) } });
    };
    xhr.onerror = () => { settle(); reject(new TypeError("Network request failed")); };
    xhr.onabort = () => { settle(); const error = new Error("Aborted"); error.name = "AbortError"; reject(error); };
    signal.addEventListener("abort", abort);
    xhr.send(body);
  });
}

/**
 * Rebuild multipart after refresh; native fetch supports React Native file parts. With `onProgress`
 * (and XMLHttpRequest available) the same request goes through `postWithProgress` to report the share of bytes sent.
 */
export const uploadFormData = async <T = unknown>(path: string, input: FormData | (() => FormData), timeoutMs = 20000, guard: () => boolean = () => true, onProgress?: (fraction: number) => void): Promise<T> => {
  await loadServerAddress();
  const scope = authBridge?.getScope() ?? null;
  for (let retry = 0; retry < 2; retry++) {
    const tokens = await authBridge?.getTokens();
    if (!guard() || scope !== (authBridge?.getScope() ?? null)) throw new Error('Account changed. Upload stopped.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${getServerAddress()}${path}`;
      const headers: Record<string, string> = {"X-Hygene-Workflow":"2","X-Hygene-App-Version":nativeAppVersion,...(tokens?.accessToken?{Authorization:`Bearer ${tokens.accessToken}`}:{})};
      const body = typeof input === "function" ? input() : input;
      const response: UploadResponse = onProgress && typeof XMLHttpRequest === "function"
        ? await postWithProgress(url, headers, body, controller.signal, onProgress)
        : await fetch(url, { method: "POST", headers, body, signal: controller.signal });
      if (!guard() || scope !== (authBridge?.getScope() ?? null)) throw new Error('Account changed. Response stopped.');
      if (response.status === 401 && retry === 0) {
        if (!guard() || scope !== (authBridge?.getScope() ?? null)) throw new Error('Account changed. Upload stopped.');
        const current=await authBridge?.getTokens();
        if(current?.accessToken===tokens?.accessToken)await refreshApiTokens();
        continue;
      }
      const json = await response.json();
      if (!guard() || scope !== (authBridge?.getScope() ?? null)) throw new Error('Account changed. Response stopped.');
      if (!response.ok) {
        const error = new Error(json?.message ?? "Request failed") as Error & { response: unknown };
        error.response = { status: response.status, data: json, headers: { 'retry-after': response.headers.get('Retry-After') } };
        throw error;
      }
      return json as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("Upload timed out. Check the result, then upload the photo again.");
      throw error;
    } finally { clearTimeout(timeout); }
  }
  throw new Error("Sign in again to upload your photos.");
};
