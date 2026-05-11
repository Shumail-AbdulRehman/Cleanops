import axios from 'axios';
import { store } from '@/store/store';
import { clearUser } from '@/store/slices/authSlice';

const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || '/api';
const normalizedApiBaseUrl = rawApiBaseUrl.replace(/\/+$/, '');

export const client = axios.create({
  baseURL: normalizedApiBaseUrl || '/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

let isRefreshing = false;
let refreshPromise: Promise<void> | null = null;

client.interceptors.response.use(
  (res) => res,
  async (error) => {
    const originalRequest = error.config;

    
    if (originalRequest.url?.includes("/common/refresh-token")) {
      isRefreshing = false;
      refreshPromise = null;
      store.dispatch(clearUser());
      return Promise.reject(error);
    }

    if (
      error.response?.status !== 401 ||
      error.response?.data?.message !== "Access Token Expired" ||
      originalRequest._retry
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      
      if (!isRefreshing) {
        isRefreshing = true;

        refreshPromise = (async () => {
          await client.post("/common/refresh-token");
        })();

        await refreshPromise;

        isRefreshing = false;
        refreshPromise = null;
      } else {
        
        await refreshPromise;
      }

      console.log("refresh token working i guess");
      return client(originalRequest);

    } catch (err) {
      isRefreshing = false;
      refreshPromise = null;
      store.dispatch(clearUser());
      return Promise.reject(err);
    }
  }
);
