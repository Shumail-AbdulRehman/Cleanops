import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import useAuth from '@/hooks/useAuth';
import { confirmBillingCheckout } from '../api';
import { billingLifecycleKey } from '../queries';
import type { BillingConfirmOutcome, ValidatedBillingLifecycle } from '../types';

export const CHECKOUT_CONFIRMATION_TIMING = {
  gaps: [2_000, 3_000, 5_000, 8_000, 13_000],
  slow: 20_000,
  total: 120_000,
} as const;

export type CheckoutConfirmationStatus = 'waiting' | 'slow' | 'timedOut' | 'active' | 'denied';
type Scope = { companyId?: number; ownerId?: number; role?: string };
type View = {
  scope: Scope;
  status: CheckoutConfirmationStatus;
  lifecycle: ValidatedBillingLifecycle | null;
  outcome: BillingConfirmOutcome | null;
  consecutiveNotPaid: number;
};

/** Server confirmation only; checkout events and cached facts cannot grant access. */
export function useCheckoutConfirmation() {
  const { user } = useAuth();
  const companyId = user?.companyId, ownerId = user?.id, role = user?.role;
  const scope = useMemo(() => ({ companyId, ownerId, role }), [companyId, ownerId, role]);
  const client = useQueryClient();
  const restart = useRef<() => void>(() => {});
  const [view, setView] = useState<View | null>(null);
  const allowed = role === 'ADMIN' && !!companyId && !!ownerId;

  useLayoutEffect(() => {
    let mounted = true;
    let stop = () => {};
    const start = () => {
      stop();
      if (!mounted || !allowed) return;
      let running = true;
      let lifecycle: ValidatedBillingLifecycle | null = null;
      let outcome: BillingConfirmOutcome | null = null;
      let consecutiveNotPaid = 0;
      let gapIndex = 0;
      let next: ReturnType<typeof setTimeout> | undefined;
      const abort = new AbortController();
      const startedAt = Date.now();
      const publish = (status: CheckoutConfirmationStatus) => setView({ scope, status, lifecycle, outcome, consecutiveNotPaid });
      const finish = (status: CheckoutConfirmationStatus) => {
        if (!running) return;
        stop();
        publish(status);
      };
      // Independent watchdogs: neither latency nor an abort-ignoring call extends the window.
      const deadline = setTimeout(() => finish('timedOut'), CHECKOUT_CONFIRMATION_TIMING.total);
      const slow = setTimeout(() => { if (running) publish('slow'); }, CHECKOUT_CONFIRMATION_TIMING.slow);
      stop = () => {
        running = false;
        clearTimeout(next);
        clearTimeout(slow);
        clearTimeout(deadline);
        abort.abort();
      };
      const alive = () => {
        if (!running) return false;
        if (Date.now() - startedAt >= CHECKOUT_CONFIRMATION_TIMING.total) {
          finish('timedOut');
          return false;
        }
        return true;
      };
      const schedule = () => {
        if (!alive()) return;
        const gaps = CHECKOUT_CONFIRMATION_TIMING.gaps;
        const delay = gaps[Math.min(gapIndex++, gaps.length - 1)];
        if (Date.now() - startedAt + delay < CHECKOUT_CONFIRMATION_TIMING.total) {
          next = setTimeout(() => { void confirm(); }, delay);
        }
      };
      const confirm = async () => {
        if (!alive()) return;
        try {
          const result = await confirmBillingCheckout(abort.signal, companyId);
          if (!alive()) return;
          // The API also validates company scope. Never publish a foreign result.
          if (result.lifecycle.company.id === companyId) {
            lifecycle = result.lifecycle;
            outcome = result.outcome;
            consecutiveNotPaid = outcome === 'NOT_PAID' ? consecutiveNotPaid + 1 : 0;
            client.setQueryData(billingLifecycleKey(companyId, ownerId), lifecycle);
            if (result.outcome === 'ACTIVE' && lifecycle.workspaceAccessAllowed &&
              lifecycle.company.isActive && lifecycle.company.operationalStatus === 'ACTIVE') {
              finish('active');
              return;
            }
            publish(Date.now() - startedAt >= CHECKOUT_CONFIRMATION_TIMING.slow ? 'slow' : 'waiting');
          } else {
            // An unscoped response cannot continue an unpaid-confirmation streak.
            consecutiveNotPaid = 0;
            publish(Date.now() - startedAt >= CHECKOUT_CONFIRMATION_TIMING.slow ? 'slow' : 'waiting');
          }
        } catch (error) {
          if (!alive()) return;
          // Keep the latest accepted outcome, but require fresh consecutive reads to redirect.
          consecutiveNotPaid = 0;
          const status = (error as { response?: { status?: number } } | null)?.response?.status;
          if (status === 401 || status === 403) {
            finish('denied');
            return;
          }
          publish(Date.now() - startedAt >= CHECKOUT_CONFIRMATION_TIMING.slow ? 'slow' : 'waiting');
        }
        // Only schedule after settlement, including transient failures.
        schedule();
      };
      publish('waiting');
      schedule();
    };
    restart.current = start;
    // StrictMode's discarded mount never dispatches a private request.
    void Promise.resolve().then(() => { if (mounted) start(); });
    return () => {
      mounted = false;
      restart.current = () => {};
      stop();
    };
  }, [allowed, client, companyId, ownerId, scope]);

  const retry = useCallback(() => restart.current(), []);
  const current = view?.scope === scope && allowed ? view : null;
  return {
    status: current?.status ?? (allowed ? 'waiting' : 'denied'),
    lifecycle: current?.lifecycle ?? null,
    outcome: current?.outcome ?? null,
    consecutiveNotPaid: current?.consecutiveNotPaid ?? 0,
    retry,
  };
}
