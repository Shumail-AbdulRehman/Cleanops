import { Environment, Paddle } from "@paddle/paddle-node-sdk";

let paddleClient: Paddle | undefined;

const requireEnvironmentVariable = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export const getPaddleEnvironment = () => {
  const environment = requireEnvironmentVariable("PADDLE_ENVIRONMENT");

  if (environment === "sandbox") return Environment.sandbox;
  if (environment === "production") return Environment.production;

  throw new Error('PADDLE_ENVIRONMENT must be either "sandbox" or "production"');
};

export const getPaddleClient = () => {
  if (!paddleClient) {
    paddleClient = new Paddle(requireEnvironmentVariable("PADDLE_API_KEY"), {
      environment: getPaddleEnvironment(),
    });
  }

  return paddleClient;
};

export const getPaddleWebhookSecret = () => {
  const secret = requireEnvironmentVariable("PADDLE_WEBHOOK_SECRET");
  if (secret.length < 32 || /changeme|placeholder|your[_-]|example/i.test(secret)) throw new Error('Billing webhook verification is unavailable');
  return secret;
};

// Environment-owned catalog only. Never infer a price or enable a trial locally.
export type PaddleCatalogEntry = { plan: 'STARTER' | 'PRO' | 'ADVANCED'; interval: 'month' | 'year'; priceId: string };
export function getPaddleCatalog(env: NodeJS.ProcessEnv = process.env): PaddleCatalogEntry[] {
  if (!['sandbox', 'production'].includes(env.PADDLE_ENVIRONMENT ?? '')) throw new Error('Billing environment is unavailable');
  let input: unknown;
  try { input = JSON.parse(env.PADDLE_PRICE_CATALOG_JSON ?? 'null'); } catch { throw new Error('Billing catalog is unavailable'); }
  if (!Array.isArray(input) || input.length < 1 || input.length > 6) throw new Error('Billing catalog is unavailable');
  const seenPrices = new Set<string>(), seenPlans = new Set<string>();
  return input.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['plan', 'interval', 'priceId'].includes(key)) ||
      !['STARTER', 'PRO', 'ADVANCED'].includes(value.plan) || !['month', 'year'].includes(value.interval) ||
      typeof value.priceId !== 'string' || !/^pri_[a-z0-9]{26}$/.test(value.priceId) ||
      seenPrices.has(value.priceId) || seenPlans.has(`${value.plan}:${value.interval}`)) throw new Error('Billing catalog is unavailable');
    seenPrices.add(value.priceId); seenPlans.add(`${value.plan}:${value.interval}`);
    return { plan: value.plan, interval: value.interval, priceId: value.priceId };
  });
}
export function configuredEntryForPrice(priceId: string): PaddleCatalogEntry | undefined {
  try { return getPaddleCatalog().find(entry => entry.priceId === priceId); } catch { return undefined; }
}
export function configuredPlanForPrice(priceId: string) {
  return configuredEntryForPrice(priceId)?.plan;
}

/** Checkout preparation has stricter prerequisites than catalog/portal reads. */
export function getPaddleCheckoutUrl(): URL {
  try {
    const url = new URL(process.env.PADDLE_CHECKOUT_URL ?? '');
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new Error();
    return url;
  } catch { throw new Error('Billing checkout configuration is unavailable'); }
}
export function requireBillingActivation() {
  if (process.env.PADDLE_BILLING_ENABLED !== 'true') throw new Error('Billing is not activated');
  getPaddleEnvironment(); getPaddleCatalog();
  const apiKey = requireEnvironmentVariable('PADDLE_API_KEY');
  if (apiKey.length < 32 || /changeme|placeholder|your[_-]|example/i.test(apiKey)) throw new Error('Billing credentials are unavailable');
}
