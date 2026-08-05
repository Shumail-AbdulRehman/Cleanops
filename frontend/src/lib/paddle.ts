import {
  CheckoutEventNames, initializePaddle,
  type CheckoutEventsData, type CheckoutEventsTotals, type Environments, type Paddle, type PaddleEventData,
} from "@paddle/paddle-js";

export { CheckoutEventNames } from "@paddle/paddle-js";
export type { PaddleEventData } from "@paddle/paddle-js";

export type PaddleEventListener = (event: PaddleEventData) => void;

let paddlePromise: Promise<Paddle> | null = null;
const listeners = new Set<PaddleEventListener>();

// Events only signal that consumers should refresh authoritative server state.
const dispatchPaddleEvent: PaddleEventListener = (event) => {
  for (const listener of [...listeners]) {
    if (!listeners.has(listener)) continue;
    try {
      listener(event);
    } catch {
      // A failing consumer must not prevent other mounted consumers receiving events.
    }
  }
};

// Subscribing does not load/reinitialize the SDK. Each registration owns its cleanup.
export const subscribePaddleEvents = (listener: PaddleEventListener): (() => void) => {
  const subscription: PaddleEventListener = (event) => listener(event);
  listeners.add(subscription);
  return () => { listeners.delete(subscription); };
};

type CheckoutAmounts = {
  totals?: CheckoutEventsTotals;
  recurringTotals?: CheckoutEventsTotals;
  currencyCode?: CheckoutEventsData["currency_code"];
};

export type NormalizedPaddleEvent = { transactionId?: string } & (
  | ({ type: "loaded" | "updated" } & CheckoutAmounts)
  | { type: "paymentFailed" | "paymentError" | "openError" | "completed" | "closed" }
);

// Copy only amounts: customer/payment details and provider error text never enter
// the normalized stream. Preserve SDK amount values without guessing currency units.
const copyTotals = (totals: CheckoutEventsTotals): CheckoutEventsTotals => ({
  subtotal: totals.subtotal,
  tax: totals.tax,
  total: totals.total,
  discount: totals.discount,
  ...(totals.balance === undefined ? {} : { balance: totals.balance }),
  ...(totals.credit === undefined ? {} : { credit: totals.credit }),
});

export const normalizePaddleEvent = (event: PaddleEventData): NormalizedPaddleEvent | null => {
  const transactionId = event.data?.transaction_id;
  const scope = transactionId ? { transactionId } : {};
  switch (event.name) {
    case CheckoutEventNames.CHECKOUT_LOADED:
    case CheckoutEventNames.CHECKOUT_UPDATED:
    case CheckoutEventNames.CHECKOUT_ITEMS_UPDATED:
      return {
        ...scope,
        type: event.name === CheckoutEventNames.CHECKOUT_LOADED ? "loaded" : "updated",
        ...(event.data?.totals ? { totals: copyTotals(event.data.totals) } : {}),
        ...(event.data?.recurring_totals ? { recurringTotals: copyTotals(event.data.recurring_totals) } : {}),
        ...(event.data?.currency_code ? { currencyCode: event.data.currency_code } : {}),
      };
    case CheckoutEventNames.CHECKOUT_PAYMENT_FAILED:
      return { ...scope, type: "paymentFailed" };
    case CheckoutEventNames.CHECKOUT_PAYMENT_ERROR:
      return { ...scope, type: "paymentError" };
    case CheckoutEventNames.CHECKOUT_ERROR:
    case CheckoutEventNames.CHECKOUT_FAILED:
      return { ...scope, type: "openError" };
    case CheckoutEventNames.CHECKOUT_COMPLETED:
      return { ...scope, type: "completed" };
    case CheckoutEventNames.CHECKOUT_CLOSED:
      return { ...scope, type: "closed" };
    default:
      return null;
  }
};

// Reuse the raw fan-out so legacy and inline consumers share one SDK callback,
// independent cleanup and exception isolation. Subscribing never loads the SDK.
export const subscribeNormalizedPaddleEvents = (
  listener: (event: NormalizedPaddleEvent) => void,
): (() => void) => subscribePaddleEvents((event) => {
  const normalized = normalizePaddleEvent(event);
  if (normalized) listener(normalized);
});

const getRequiredEnvironmentVariable = (name: string, value: string | undefined) => {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required. Paddle has not been initialized.`);
  }
  return normalized;
};

const readPaddleConfig = () => {
  const environment = getRequiredEnvironmentVariable(
    "VITE_PADDLE_ENVIRONMENT",
    import.meta.env.VITE_PADDLE_ENVIRONMENT,
  );
  const token = getRequiredEnvironmentVariable(
    "VITE_PADDLE_CLIENT_TOKEN",
    import.meta.env.VITE_PADDLE_CLIENT_TOKEN,
  );

  if (environment !== "sandbox" && environment !== "production") {
    throw new Error('VITE_PADDLE_ENVIRONMENT must be either "sandbox" or "production".');
  }
  if (environment === "sandbox" && !token.startsWith("test_")) {
    throw new Error("Sandbox Paddle requires a client-side token beginning with test_.");
  }
  if (environment === "production" && !token.startsWith("live_")) {
    throw new Error("Production Paddle requires a client-side token beginning with live_.");
  }

  return { environment: environment as Environments, token };
};

// The installed wrapper retains rejected CDN promises. Load the official script
// first so failed downloads remain retryable without poisoning its internal cache.
const loadPaddleScript = (): Promise<void> => {
  if (window.PaddleBillingV1) return Promise.resolve();
  const src = "https://cdn.paddle.com/paddle/v2/paddle.js";
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    const script = existing ?? document.createElement("script");
    const cleanup = () => {
      window.clearTimeout(watchdog);
      script.removeEventListener("load", loaded);
      script.removeEventListener("error", failed);
    };
    const failed = () => {
      cleanup();
      script.remove();
      reject(new Error("Paddle.js could not be loaded."));
    };
    const loaded = () => {
      if (!window.PaddleBillingV1) return failed();
      cleanup();
      resolve();
    };
    const watchdog = window.setTimeout(() => {
      cleanup();
      script.remove();
      reject(new Error("Paddle.js loading timed out."));
    }, 15_000);
    script.addEventListener("load", loaded);
    script.addEventListener("error", failed);
    if (!existing) {
      script.src = src;
      document.head.appendChild(script);
    }
  });
};

export const getPaddle = () => {
  if (!paddlePromise) {
    try {
      const config = readPaddleConfig();
      paddlePromise = loadPaddleScript().then(() =>
        initializePaddle({ ...config, eventCallback: dispatchPaddleEvent }),
      ).then((paddle) => {
        if (!paddle?.Initialized) throw new Error("Paddle.js could not be initialized.");
        return paddle;
      }).catch((error: unknown) => {
        // Retry only on a subsequent explicit call; never reset a successful singleton.
        paddlePromise = null;
        throw error;
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  return paddlePromise;
};

export type InlineCheckoutOptions = { transactionId: string; frameTarget: string };

// Opening is not readiness or payment proof. Only checkout.loaded marks the form
// usable; completion still requires an authoritative server read by the caller.
export const openInlineCheckout = async ({ transactionId, frameTarget }: InlineCheckoutOptions): Promise<void> => {
  const paddle = await getPaddle();
  paddle.Checkout.open({
    transactionId,
    settings: {
      displayMode: "inline",
      variant: "one-page",
      frameTarget,
      frameInitialHeight: 450,
      frameStyle: "width: 100%; min-width: 312px; background-color: transparent; border: none;",
      allowLogout: false,
      showAddDiscounts: false,
      theme: "light",
      locale: "en",
    },
  });
};
