import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import useAuth from '@/hooks/useAuth';
import { getCurrentUser } from '@/api/auth';
import { getPaddle, openInlineCheckout, subscribeNormalizedPaddleEvents, subscribePaddleEvents, CheckoutEventNames, type NormalizedPaddleEvent } from '@/lib/paddle';
import { getBillingLifecycle, prepareBillingCheckout } from '../api';
import { billingLifecycleKey } from '../queries';
import type { BillingCheckoutResume, BillingInterval, PlanCode, ValidatedBillingLifecycle } from '../types';
import { billingRequest, BillingRequestError, BILLING_REQUEST_LIMITS } from './billingRequest';
import { checkoutActions, checkoutReducer, createCheckoutState, type CheckoutEvent, type CheckoutState } from './checkoutMachine';

export type CheckoutSelection = { plan: PlanCode; interval: BillingInterval };
export type CheckoutTotals = Pick<Extract<NormalizedPaddleEvent, { type: 'loaded' | 'updated' }>, 'totals' | 'recurringTotals' | 'currencyCode'>;
type Scope = { companyId?: number; ownerId?: number; role?: string };
type View = { scope: Scope; state: CheckoutState; prepared: BillingCheckoutResume | null; totals: CheckoutTotals | null; actionBusy: boolean; statusBusy: boolean };
type SessionEvent = CheckoutEvent extends infer E ? E extends CheckoutEvent ? Omit<E, 'sessionId'> : never : never;
type Controller = { run: (selection?: CheckoutSelection, replace?: boolean) => Promise<void>; checkStatus: () => Promise<void>; retry: () => Promise<void>; register: (target: string | null) => void };
let generation = 0;
const validSelection = (selection?: CheckoutSelection): selection is CheckoutSelection => !!selection &&
  ['STARTER', 'PRO', 'ADVANCED'].includes(selection.plan) && ['month', 'year'].includes(selection.interval);

/** One mounted owner, no persistence. Browser completion only hands off to confirmation. */
export function useCheckoutSession(selection?: CheckoutSelection) {
  const { user } = useAuth();
  const companyId = user?.companyId, ownerId = user?.id, role = user?.role;
  const scope = useMemo(() => ({ companyId, ownerId, role }), [companyId, ownerId, role]);
  const client = useQueryClient();
  const controller = useRef<Controller | null>(null);
  const target = useRef<string | null>(null);
  const initialSelection = useRef(selection);
  // URL/language rerenders never replace a saved draft or restart the controller.
  useLayoutEffect(() => { initialSelection.current = selection; }, [selection]);
  const [view, setView] = useState<View | null>(null);

  useLayoutEffect(() => {
    let active = true;
    let state = createCheckoutState(++generation);
    let prepared: BillingCheckoutResume | null = null;
    let totals: CheckoutTotals | null = null;
    let actionBusy = false, statusBusy = false;
    let paddle: Awaited<ReturnType<typeof getPaddle>> | null = null;
    let opened = false;
    let unsubscribeFrame = () => {};
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let frameGeneration = 0;
    let paymentDeadline: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    const key = billingLifecycleKey(companyId, ownerId);
    const publish = () => { if (active) setView({ scope, state, prepared, totals, actionBusy, statusBusy }); };
    const closeFrame = () => {
      frameGeneration++;
      clearTimeout(watchdog);
      clearTimeout(paymentDeadline);
      unsubscribeFrame();
      unsubscribeFrame = () => {};
      if (opened) { opened = false; try { paddle?.Checkout.close(); } catch { /* Best effort teardown. */ } }
    };
    const send = (event: SessionEvent) => {
      if (!active) return;
      state = checkoutReducer(state, { ...event, sessionId: state.sessionId } as CheckoutEvent);
      if (state.status === 'restricted' || state.status === 'confirming') closeFrame();
      publish();
    };
    const openFrame = () => {
      if (!active || opened || !paddle || !target.current || state.status !== 'frameLoading' || !state.transactionId) return;
      const transactionId = state.transactionId;
      const currentFrame = ++frameGeneration;
      const currentSession = state.sessionId;
      opened = true;
      const alive = () => active && currentFrame === frameGeneration && currentSession === state.sessionId;
      const unsubscribeAmounts = subscribeNormalizedPaddleEvents(event => {
        if (!alive() || (event.transactionId && event.transactionId !== transactionId)) return;
        if (!event.transactionId && event.type !== 'openError') return;
        if (event.type === 'loaded' || event.type === 'updated') {
          totals = { ...totals, ...('totals' in event ? { totals: event.totals } : {}),
            ...('recurringTotals' in event ? { recurringTotals: event.recurringTotals } : {}),
            ...('currencyCode' in event ? { currencyCode: event.currencyCode } : {}) };
          if (event.type === 'loaded') { clearTimeout(watchdog); send({ type: 'frameLoaded', transactionId }); }
          else publish();
        } else {
          clearTimeout(paymentDeadline);
          const type = { paymentFailed: 'checkout.payment.failed', paymentError: 'checkout.payment.error',
            openError: 'checkout.error', completed: 'completed', closed: 'checkout.error' } as const;
          send({ type: type[event.type], transactionId: event.transactionId ?? null });
        }
      });
      // The normalized adapter intentionally drops initiated events. Read only
      // their name and transaction ID; never retain the raw payment payload.
      const unsubscribeAttempt = subscribePaddleEvents(event => {
        if (!alive() || event.name !== CheckoutEventNames.CHECKOUT_PAYMENT_INITIATED || event.data?.transaction_id !== transactionId) return;
        send({ type: 'paymentAttempted', transactionId });
        if (state.status !== 'paying') return;
        clearTimeout(paymentDeadline);
        paymentDeadline = setTimeout(() => {
          if (!alive()) return;
          closeFrame();
          state = createCheckoutState(++generation);
          send({ type: 'serverFactsRead', facts: { onboardingStep: null, checkoutResume: null } });
        }, BILLING_REQUEST_LIMITS.confirm);
      });
      unsubscribeFrame = () => { unsubscribeAmounts(); unsubscribeAttempt(); };
      watchdog = setTimeout(() => {
        if (alive()) send({ type: 'frameTimeout', transactionId });
      }, 20_000);
      void openInlineCheckout({ transactionId, frameTarget: target.current }).catch(() => {
        if (alive()) send({ type: 'checkout.error', transactionId });
      });
    };
    const acceptFacts = (facts: ValidatedBillingLifecycle) => {
      if (!active || facts.company.id !== companyId) return;
      const restricted = !facts.company.isActive || facts.company.operationalStatus !== 'ACTIVE';
      const next = facts.checkoutResume;
      const terminal = ['CONFIRMING', 'WORKSPACE', 'ACCOUNT', 'VERIFY_EMAIL', 'UNAVAILABLE', 'RECONCILE'].includes(facts.onboardingStep ?? '');
      const changedDraft = prepared && (next ? next.transactionId !== prepared.transactionId : facts.onboardingStep === 'CHOOSE_PLAN');
      if (!actionBusy && (changedDraft || (terminal && !['checking', 'confirming', 'restricted'].includes(state.status)))) {
        closeFrame(); totals = null; state = createCheckoutState(++generation);
      }
      send({ type: 'serverFactsRead', facts: restricted ? { ...facts, onboardingStep: 'RESTRICTED' } : facts });
      if (state.transactionId === next?.transactionId) prepared = next;
      if (!state.transactionId) prepared = null;
      publish(); openFrame();
    };
    const verifyOwner = async () => {
      const actor = await billingRequest(() => getCurrentUser(), BILLING_REQUEST_LIMITS.read, abort.signal);
      if (!active) return false;
      if (role !== 'ADMIN' || !companyId || !ownerId || actor?.role !== 'ADMIN' || actor.id !== ownerId || actor.companyId !== companyId) {
        send({ type: 'serverFactsRead', facts: { onboardingStep: 'RESTRICTED', checkoutResume: null } });
        return false;
      }
      return true;
    };
    const read = async () => {
      const facts = await client.fetchQuery({ queryKey: key, queryFn: ({ signal }) => getBillingLifecycle(signal, companyId), staleTime: 0, retry: false });
      if (facts.company.id !== companyId) throw new Error('Billing scope changed');
      if (active) acceptFacts(facts);
      return facts;
    };
    const loadSdk = async () => {
      try { paddle = await getPaddle(); return active; }
      catch { send({ type: 'scriptFailed' }); return false; }
    };
    const run = async (chosen = initialSelection.current, replace = false) => {
      if (!active || actionBusy || statusBusy) return;
      if (replace ? !checkoutActions[state.status].includes('changePlan') : state.status !== 'checking') return;
      actionBusy = true; publish();
      let submitted = false;
      try {
        if (!await verifyOwner()) return;
        let facts = await read();
        if (!active || ['restricted', 'confirming', 'unresolved', 'offline'].includes(state.status)) return;
        if (!await loadSdk()) return;
        // Recheck after script loading: another tab or login may have changed the facts.
        if (!await verifyOwner()) return;
        facts = await read();
        if (!active || ['restricted', 'confirming', 'unresolved', 'offline'].includes(state.status)) return;
        if (state.transactionId && !replace) { openFrame(); return; }
        if (!validSelection(chosen)) {
          send({ type: 'serverFactsRead', facts: { onboardingStep: null, checkoutResume: null } }); return;
        }
        if (!facts.billingConfigured || !facts.checkoutAvailable || facts.reconciliationRequired || facts.subscription || facts.workspaceAccessAllowed ||
          !['CHOOSE_PLAN', 'PAYMENT'].includes(facts.onboardingStep ?? '')) {
          closeFrame(); state = createCheckoutState(++generation);
          send({ type: 'serverFactsRead', facts: { onboardingStep: null, checkoutResume: null } }); return;
        }
        if (replace) { send({ type: 'replaceStarted' }); closeFrame(); }
        else send({ type: 'prepareStarted' });
        if (state.status !== (replace ? 'replacing' : 'preparing')) return;
        submitted = true;
        const result = await prepareBillingCheckout(chosen.plan, chosen.interval, abort.signal);
        if (!active) return;
        prepared = { ...chosen, transactionId: result.transactionId }; totals = null;
        send({ type: replace ? 'replaced' : 'prepareSucceeded', transactionId: result.transactionId });
        openFrame();
      } catch (error) {
        if (!active) return;
        if (submitted) send({ type: error instanceof BillingRequestError && !error.sent ? 'prepareFailed' : 'prepareTimedOut' });
        else send({ type: 'serverFactsRead', facts: { onboardingStep: null, checkoutResume: null } });
      } finally { actionBusy = false; publish(); }
    };
    const checkStatus = async () => {
      if (!active || statusBusy) return;
      statusBusy = true; publish();
      try {
        if (await verifyOwner()) {
          await read();
          if (!actionBusy && state.status === 'frameLoading' && (paddle || await loadSdk())) openFrame();
        }
      }
      catch { send({ type: 'serverFactsRead', facts: { onboardingStep: null, checkoutResume: null } }); }
      finally { statusBusy = false; publish(); }
      if (!actionBusy && state.status === 'checking') await run();
    };
    const retry = async () => {
      if (!active || actionBusy || statusBusy || !checkoutActions[state.status].includes('tryAgain') || !navigator.onLine) return;
      closeFrame(); send({ type: 'tryAgain' });
      if (state.status === 'checking') await run();
      else if (state.status === 'frameLoading' && await loadSdk()) openFrame();
    };
    controller.current = { run, checkStatus, retry, register: value => {
      if (target.current === value) return;
      target.current = value;
      closeFrame(); openFrame();
    } };
    const unsubscribeCache = client.getQueryCache().subscribe(event => {
      if (event.type === 'updated' && event.action.type === 'success' &&
        event.query.queryKey.length === key.length && event.query.queryKey.every((value: unknown, i: number) => value === key[i])) {
        acceptFacts(event.query.state.data as ValidatedBillingLifecycle);
      }
    });
    const offline = () => send({ type: 'offline' });
    const online = () => {
      send({ type: 'online' });
      if (state.status === 'checking') void run();
      else if (state.status === 'frameLoading') {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => send({ type: 'frameTimeout', transactionId: state.transactionId }), 20_000);
        openFrame();
      }
    };
    window.addEventListener('offline', offline); window.addEventListener('online', online);
    // Defer startup so React StrictMode's discarded effect cannot send a purchase.
    void Promise.resolve().then(async () => {
      if (!active) return;
      publish();
      if (role !== 'ADMIN' || !companyId || !ownerId) {
        send({ type: 'serverFactsRead', facts: { onboardingStep: 'RESTRICTED', checkoutResume: null } });
      } else if (!navigator.onLine) offline();
      else await run();
    });
    return () => {
      active = false; controller.current = null; abort.abort(); closeFrame(); unsubscribeCache();
      window.removeEventListener('offline', offline); window.removeEventListener('online', online);
      const query = client.getQueryCache().find({ queryKey: key, exact: true });
      if (!query?.getObserversCount()) {
        void client.cancelQueries({ queryKey: key, exact: true });
        client.removeQueries({ queryKey: key, exact: true });
      }
    };
  }, [scope, companyId, ownerId, role, client]);

  const registerFrameTarget = useCallback((value: string | null) => {
    // The child may register before the parent's layout effect.
    if (controller.current) controller.current.register(value);
    else target.current = value;
  }, []);
  const checkStatus = useCallback(() => controller.current?.checkStatus() ?? Promise.resolve(), []);
  const tryAgain = useCallback(() => controller.current?.retry() ?? Promise.resolve(), []);
  const changePlan = useCallback((chosen: CheckoutSelection) => controller.current?.run(chosen, true) ?? Promise.resolve(), []);
  const visible = view?.scope === scope ? view : null;
  const state = visible?.state ?? createCheckoutState(0);
  return { state, status: state.status, prepared: visible?.prepared ?? null, totals: visible?.totals ?? null,
    actionBusy: visible?.actionBusy ?? false, statusBusy: visible?.statusBusy ?? false,
    actions: checkoutActions[state.status], registerFrameTarget, checkStatus, tryAgain, changePlan };
}
