import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installModuleLoadRecovery } from './moduleLoadRecovery';

let uninstall: (() => void) | undefined;
const failure = (message = 'error loading dynamically imported module: /assets/SubscriptionPage-old.js') => {
  const event = new Event('vite:preloadError', { cancelable: true });
  Object.assign(event, { payload: new TypeError(message) });
  window.dispatchEvent(event);
  return event;
};
beforeEach(() => { sessionStorage.clear(); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); });
afterEach(() => { uninstall?.(); vi.restoreAllMocks(); });
it('recovers a missing lazy route once, retaining the current URL and session', () => {
  const reload = vi.fn(); uninstall = installModuleLoadRecovery(window, reload);
  expect(failure().defaultPrevented).toBe(true);
  failure(); expect(reload).toHaveBeenCalledOnce();
  uninstall(); uninstall = installModuleLoadRecovery(window, reload);
  expect(failure().defaultPrevented).toBe(false);
  expect(reload).toHaveBeenCalledOnce();
});
it('allows recovery again after the cooldown expires', () => {
  sessionStorage.setItem('hygene-ops.module-recovery-at', String(Date.now() - 61_000));
  const reload = vi.fn(); uninstall = installModuleLoadRecovery(window, reload);
  failure('Failed to fetch dynamically imported module: /assets/SubscriptionPage-old.js');
  expect(reload).toHaveBeenCalledOnce();
});
it('leaves real application errors to the error boundary', () => {
  const reload = vi.fn(); uninstall = installModuleLoadRecovery(window, reload);
  expect(failure('Cannot read properties of undefined').defaultPrevented).toBe(false);
  expect(reload).not.toHaveBeenCalled();
});
it('does not reload when offline', () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const reload = vi.fn(); uninstall = installModuleLoadRecovery(window, reload);
  failure(); expect(reload).not.toHaveBeenCalled();
});
it('does not risk a reload loop when session storage is blocked', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Denied'); });
  const reload = vi.fn(); uninstall = installModuleLoadRecovery(window, reload);
  expect(failure().defaultPrevented).toBe(false);
  expect(reload).not.toHaveBeenCalled();
});
