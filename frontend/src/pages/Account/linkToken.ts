// Imported first by main.tsx: scrub credentials before mounting routes or making requests.
// Keep only in volatile module memory; never localStorage, query cache or navigation state.
let captured: {path: string; token: string} | undefined;
if (typeof window !== 'undefined' && ['/verify-owner-email', '/reset-owner-password'].includes(window.location.pathname)) {
 const path = window.location.pathname;
 const fragment = new URLSearchParams(window.location.hash.slice(1));
 const token = fragment.get('token');
 window.history.replaceState(window.history.state, '', path);
 if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) captured = {path, token};
}
export function ownerLinkToken(path: string) { return captured?.path === path ? captured.token : undefined; }
export function forgetOwnerLinkToken() { captured = undefined; }
