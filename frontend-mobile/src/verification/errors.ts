export function verificationErrorMessage(error: unknown): string {
  const e = error as { response?: { data?: { message?: string } }; message?: string; code?: string };
  if (e?.response?.data?.message) return e.response.data.message;
  if (e?.message === 'Network Error' || e?.code === 'ERR_NETWORK')
    return 'Internet needed to continue. Check your connection and try again.';
  if (/URI is not absolute|Invalid URL|HostFunction|java\.lang\./.test(e?.message ?? ''))
    return 'Secure photo storage could not open. Retry saved photos. Keep the app data so your saved work is preserved.';
  return e?.message ?? 'Try again when connected.';
}
