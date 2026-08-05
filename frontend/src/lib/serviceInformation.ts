type PublicEnvironment = Record<string, string | undefined>;
export function approvedLink(raw: string | undefined, origin: string | undefined, approved: string | undefined): string | null {
  if (approved !== 'true' || !raw || !origin) return null;
  try {
    const expected = new URL(origin), url = new URL(raw);
    if (expected.origin !== origin || expected.protocol !== 'https:' || url.protocol !== 'https:' || url.origin !== expected.origin || url.username || url.password || url.search || url.hash || /[\s\\]/.test(raw) || url.pathname === '/') return null;
    return url.href;
  } catch { return null; }
}
export function serviceInformation(env: PublicEnvironment = import.meta.env) {
  const link = (name: string) => approvedLink(env[name], env.VITE_SERVICE_POLICY_ORIGIN, env.VITE_SERVICE_POLICIES_APPROVED);
  const terms = link('VITE_SERVICE_TERMS_URL'), privacy = link('VITE_SERVICE_PRIVACY_URL'), exit = link('VITE_SERVICE_EXIT_URL');
  return { terms, privacy, exit, policiesReady: !!terms && !!privacy && !!exit,
    android: approvedLink(env.VITE_ANDROID_DOWNLOAD_URL, env.VITE_ANDROID_DOWNLOAD_ORIGIN, env.VITE_ANDROID_DISTRIBUTION_APPROVED) };
}
export async function getPublicSupport(signal?: AbortSignal): Promise<{ email: string | null }> {
  const base = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '') || '/api';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const cancel = () => { clearTimeout(timeout); controller.abort(); };
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = await fetch(`${base}/support/contact`, { signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Support unavailable');
    const { data } = await response.json();
    const email = typeof data?.email === 'string' ? data.email : '';
    if (data?.available === true && data.channel === 'EMAIL' && data.verification === 'OPERATOR_CONFIGURED' && email.length <= 254 && /^[^\s@<>?#;]+@[^\s@<>?#;]+\.[^\s@<>?#;]+$/.test(email)) return { email };
    return { email: null };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}
