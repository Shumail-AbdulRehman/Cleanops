const rawApiBaseUrl =
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || "http://10.0.2.2:8080/api";

const normalizedApiBaseUrl = rawApiBaseUrl.replace(/\/+$/, "");

export const API_BASE_URL = normalizedApiBaseUrl.endsWith("/api")
  ? normalizedApiBaseUrl
  : `${normalizedApiBaseUrl}/api`;

export const STORAGE_KEY = "@cleanops-staff/auth";
