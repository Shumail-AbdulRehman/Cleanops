import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { store } from '@/store/store';
import { clearUser } from '@/store/slices/authSlice';

const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || '/api';
const normalizedApiBaseUrl = rawApiBaseUrl.replace(/\/+$/, '');

export const client = axios.create({
  baseURL: normalizedApiBaseUrl || '/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

client.interceptors.request.use((config) => {
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  return config;
});

/** A permission restriction or an outage is not evidence of a lost session. */
export function isSessionInvalid(error: unknown): boolean {
  const response = (error as { response?: { status?: number; data?: {
    message?: string; errors?: Array<{ code?: string }>;
  } } } | null)?.response;
  return response?.status === 401 || (response?.status === 403 && (
    response.data?.message === 'Account is deactivated' ||
    response.data?.errors?.some(item => item.code === 'SESSION_REVOKED') === true
  ));
}

type SessionRequestConfig = AxiosRequestConfig & { _retry?: boolean };
let refreshPromise: Promise<AxiosResponse | null> | null = null;

async function restoreSession(): Promise<AxiosResponse | null> {
  try {
    await client.post('/common/refresh-token');
    return null;
  } catch {
    // Another tab may have rotated the cookies, or the refresh reply was lost.
    // Bypass refresh here so a failed probe cannot start another refresh loop.
    try {
      return await client.get('/common/get-current-user', { _retry: true } as SessionRequestConfig);
    } catch (error) {
      if (isSessionInvalid(error)) store.dispatch(clearUser());
      throw error;
    }
  }
}

client.interceptors.response.use(
  (res) => res,
  async (error) => {
    const originalRequest = error.config;

    if (
      !originalRequest ||
      originalRequest.url?.includes('/common/refresh-token') ||
      error.response?.status !== 401 ||
      error.response?.data?.message !== "Access Token Expired" ||
      originalRequest._retry
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    if (!refreshPromise) {
      refreshPromise = restoreSession().finally(() => { refreshPromise = null; });
    }
    const recoveredUser = await refreshPromise;
    if (recoveredUser && originalRequest.url === '/common/get-current-user') return recoveredUser;
    return client(originalRequest);
  }
);
