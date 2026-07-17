import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  test as base,
  expect,
  type Page,
  type APIRequestContext,
  type BrowserContext,
} from "@playwright/test";
const require = createRequire(
  new URL("../../backend/package.json", import.meta.url),
);
const { Client } = require("pg");
base.use({ actionTimeout: 10000 });
type ReliabilityScheduleFixture = {
  ownerKey: string;
  locationId: number;
  areaName: string;
  workerId: number;
  workerName: string;
};
export type Fixture = {
  password: string;
  review: { id: number; taskId: number };
  company: Record<string, number>;
  site: Record<string, number>;
  users: Record<string, { id: number; email: string }>;
  staff: Record<string, { id: number; email: string; phone: string }>;
  attendance: Record<string, number>;
  openShiftDate: string;
  workDays: { today: string; week: string; area: string };
  cleaningSchedules: {
    locationId: number;
    week: string;
    records: Array<{ id: number; title: string; worker: string | null; repeatDays: string[] }>;
  };
  reliability: {
    effectiveDate: string;
    overlapTitle: string;
    starter: ReliabilityScheduleFixture;
    enterprise: ReliabilityScheduleFixture;
    dirty: { reviewerKey: string; reviewId: number; requirementId: string; assetId: string };
  };
  task: Record<string, number>;
};
export const fixture: Fixture = JSON.parse(
  readFileSync(process.env.HYGENE_E2E_MANIFEST!, "utf8"),
);
export const openShiftAttendancePath = `/attendance?from=${fixture.openShiftDate}&to=${fixture.openShiftDate}`;
export const backend = process.env.HYGENE_E2E_BACKEND_ORIGIN!;
function managedDatabase() {
  const target = new URL(process.env.HYGENE_E2E_DATABASE_URL!);
  if (process.env.HYGENE_E2E_MANAGED !== 'true' || !['postgres:', 'postgresql:'].includes(target.protocol) ||
      target.hostname !== '127.0.0.1' || target.port !== '56442' || target.username !== 'fixture' || target.password ||
      !/^\/priv_e2e_test_[a-f0-9]{32}$/.test(target.pathname) || target.search || target.hash) {
    throw new Error('SQL fixtures require the managed disposable E2E child');
  }
  return target.href;
}
export async function sql(text: string, values: unknown[] = []) {
  const db = new Client({
    connectionString: managedDatabase(),
  });
  await db.connect();
  try {
    return (await db.query(text, values)).rows;
  } finally {
    await db.end();
  }
}
const contexts = new WeakMap<APIRequestContext, BrowserContext>();
const sessions = new Map<string, Awaited<ReturnType<APIRequestContext['storageState']>>>();
export async function verifySeededStaffCode(request: APIRequestContext, who: string, wrong = false) {
  const { phone } = fixture.staff[who];
  const signingKey = process.env.REFRESH_TOKEN_SECRET!;
  // Same per-run derivation as seed.mjs. Neither fixture file contains the code.
  const seed = createHmac("sha256", signingKey).update(`e2e-staff-code:${phone}`).digest();
  const code = String((seed.readUInt32BE() + Number(wrong)) % 1_000_000).padStart(6, "0");
  return request.post(backend + '/api/common/staff-login/verify-code', { data: { phone, code } });
}

export async function renewSeededStaffCode(who: string) {
  await sql('UPDATE "StaffLoginCode" SET "expiresAt" = now() + interval \'5 minutes\' WHERE phone = $1 AND "consumedAt" IS NULL',
    [fixture.staff[who].phone]);
}

export async function login(request: APIRequestContext, who = "ownerA") {
  const person = fixture.users[who] ?? fixture.staff[who];
  const context = contexts.get(request);
  // Private managed temp directory is removed by run.mjs, including on failure.
  // Reuse valid synthetic sessions across Playwright worker replacement as well.
  const cachePath = join(process.env.HYGENE_E2E_RUNTIME_DIR!, `session-${who}.json`);
  const saved = sessions.get(who) ?? (existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : undefined);
  if (saved) {
    // Earlier refresh/logout tests can rotate the cached synthetic session.
    // Keep setup cookies consistent with the actual disposable account's token.
    const table = fixture.users[who] ? 'Manager' : 'Staff';
    const [account] = await sql(`SELECT "refreshToken" FROM "${table}" WHERE id=$1`, [person.id]);
    if (account?.refreshToken) {
      const cookies = saved.cookies.map((cookie: { name: string; value: string }) => cookie.name === 'refreshToken' ? { ...cookie, value: account.refreshToken } : cookie);
      if (context) {
        await context.addCookies(cookies);
        const current = await request.get(backend + '/api/common/get-current-user');
        if (current.status() === 200) {
          const user = (await current.json()).data;
          if (user.id === person.id && user.email === person.email) return;
        }
      } else {
        const renewed = await request.post(backend + '/api/common/refresh-token', { headers: { cookie: 'refreshToken=' + account.refreshToken } });
        if (renewed.status() === 200) return;
      }
    }
  }
  let response;
  if (fixture.staff[who]) {
    await renewSeededStaffCode(who);
    response = await verifySeededStaffCode(request, who);
  } else {
    response = await request.post(
      `${backend}/api/common/login`,
      { data: { email: person.email, password: fixture.password } },
    );
  }
  expect(response.status()).toBe(200);
  const state = await request.storageState();
  sessions.set(who, state);
  writeFileSync(cachePath, JSON.stringify(state), { mode: 0o600 });
}
export async function enter(
  page: Page,
  path: string,
  who = "ownerA",
  language = "en",
) {
  contexts.set(page.request, page.context());
  await login(page.request, who);
  await page.addInitScript(
    (value) => localStorage.setItem("hygene-ops.language", value),
    language,
  );
  await page.goto(path);
}
// Credential-bearing flows disable traces, video and screenshots; temporary synthetic sessions stay private.
export const test = base.extend<{ resetDatabase: void }>({
  resetDatabase: [async ({ playwright }, provide) => {
    void playwright;
    const path = join(process.env.HYGENE_E2E_RUNTIME_DIR!, 'seed-snapshot.json');
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as {
      tables: { table: string; rows: unknown[] }[];
      sequences: { sequencename: string; last_value: string; is_called: boolean }[];
    };
    const db = new Client({ connectionString: managedDatabase() });
    const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
    await db.connect();
    try {
      await db.query('BEGIN');
      // Preserve still-valid real login sessions; resetting them would make
      // independent cases exhaust the API's in-memory login rate limit.
      for (const name of ['Manager', 'Staff']) {
        const current = (await db.query(`SELECT id,password,"credentialVersion","refreshToken" FROM ${quote(name)}`)).rows;
        const table = snapshot.tables.find(row => row.table === name);
        for (const value of table?.rows ?? []) {
          const row = value as { id: number; password: string; credentialVersion: number; refreshToken: string | null };
          const saved = current.find((account: typeof row) => account.id === row.id && account.password === row.password && account.credentialVersion === row.credentialVersion);
          if (saved) row.refreshToken = saved.refreshToken;
        }
      }
      // The local fixture role is a superuser. Disable triggers only inside this
      // reset transaction to restore circular seed links; real API requests run
      // with all constraints and authorization enabled after COMMIT.
      await db.query('SET LOCAL session_replication_role = replica');
      await db.query('TRUNCATE ' + snapshot.tables.map(row => quote(row.table)).join(', ') + ' RESTART IDENTITY CASCADE');
      for (const row of snapshot.tables) if (row.rows.length) {
        const table = quote(row.table);
        await db.query(`INSERT INTO ${table} SELECT * FROM json_populate_recordset(NULL::${table}, $1::json)`, [JSON.stringify(row.rows)]);
      }
      for (const sequence of snapshot.sequences) {
        await db.query('SELECT setval($1::regclass,$2::bigint,$3)', [quote(sequence.sequencename), sequence.last_value, sequence.is_called]);
      }
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally { await db.end(); }
    await provide();
  }, { auto: true }],
  context: async ({ context }, provide) => {
    contexts.set(context.request, context);
    await provide(context);
    contexts.delete(context.request);
  },
});
export { expect };

// Controlled provider boundary only. SQL service invariants are tested separately.
// State lives in this fixture across document reloads, never in browser storage.
export async function mockBilling(page: Page, options: { persisted?: boolean; customerMode?: 'adopt' | 'conflict' | 'rejectOnce' } = {}) {
  const transactionId = 'txn_' + (options.persisted ? randomUUID().replaceAll('-', '').slice(0, 26) : 'a'.repeat(26));
  const facts: Record<string, unknown> = {
    subscription: null, providerState: 'NOT_LINKED', billingConfigured: true,
    billingEnvironment: 'sandbox', ownerVerified: false, reconciliationRequired: false,
    checkoutAvailable: true, portalAvailable: false, checkoutReadiness: 'READY',
    workspaceAccessAllowed: false, onboardingRequired: true, checkoutResume: null,
    onboardingStep: 'CHOOSE_PLAN', recoveryReason: null,
  };
  let base: Record<string, unknown> | null = null;
  const controls = { catalog: 'ok', checkout: 'ok', sdk: 'ok', lifecycle: 'ok', posts: 0, reads: 0, confirms: 0, reconciles: 0, confirm: 'PROCESSING', reconcile: 'UNRESOLVED', loaded: true };
  const drafts: { id: string; plan: string; interval: string; status: string }[] = [];
  const catalog = ['month', 'year'].flatMap(interval => ['STARTER', 'PRO', 'ADVANCED'].map((plan, i) => ({
    plan, interval, priceId: 'pri_' + String.fromCharCode(97 + i + (interval === 'year' ? 3 : 0)).repeat(26),
    productId: 'pro_' + 'b'.repeat(26), amount: String([1800, 6400, 17600][i] * (interval === 'year' ? 10 : 1)), currencyCode: 'USD',
  })));
  // Opt-in SQL boundary for the complete signup flow. Execute the real services
  // with an injected no-network provider, in the runner's disposable child only.
  const providerCustomer = 'ctm_' + randomUUID().replaceAll('-', '').slice(0, 26);
  const providerSubscription = 'sub_' + randomUUID().replaceAll('-', '').slice(0, 26);
  let service: { lifecycle: () => Promise<Record<string, unknown>>; checkout: (selection: object) => Promise<{ transactionId: string; reused: boolean; replaced: boolean }>; confirm: () => Promise<object>; reconcile: () => Promise<object>; close: () => Promise<void> } | null = null;
  const services = async () => {
    if (service) return service;
    // Recheck the child guard before loading Prisma; dotenv may read only /dev/null.
    if (process.env.DATABASE_URL !== process.env.HYGENE_E2E_DATABASE_URL) throw new Error('Prisma must use the managed E2E child');
    await sql('SELECT 1');
    process.env.DOTENV_CONFIG_PATH = '/dev/null';
    process.env.PADDLE_BILLING_ENABLED = 'true';
    process.env.PADDLE_API_KEY = 'isolated-no-network-fixture-000000000';
    process.env.PADDLE_CHECKOUT_URL = 'https://workspace.example.invalid/choose-plan';
    const current = await page.request.get(backend + '/api/common/get-current-user');
    expect(current.status()).toBe(200); const actor = (await current.json()).data;
    const load = (name: string) => import(new URL('../../backend/dist/services/' + name + '.js', import.meta.url).href);
    const lifecycle = await load('billingLifecycle.service');
    const confirmation = await load('billingConfirm.service');
    const reconciliation = await load('billingReconcile.service');
    const { prisma } = await import(new URL('../../backend/dist/prisma/prisma.js', import.meta.url).href);
    const now = new Date().toISOString();
    const { BillingProviderError } = await load('billingProvider');
    if (options.customerMode === 'conflict') {
      await prisma.company.create({ data: { name: 'SQL42 foreign customer fixture', billingCustomerId: providerCustomer } });
    }
    let customerCalls = 0;
    const customer = { id: providerCustomer, email: actor.email, name: actor.name, status: 'active', createdAt: now, updatedAt: now };
    let saved: Record<string, unknown> | null = null;
    const priceId = 'pri_00000000000000000000000001';
    const provider = {
      customers: {
        create: async () => {
          customerCalls++;
          if (options.customerMode === 'rejectOnce' && customerCalls === 1) throw new BillingProviderError('customers.create', { classification: 'REJECTED', providerCode: 'invalid_field', customerId: null });
          if (options.customerMode === 'adopt' || options.customerMode === 'conflict') throw new BillingProviderError('customers.create', { classification: 'CUSTOMER_EXISTS', providerCode: 'customer_already_exists', customerId: providerCustomer });
          return customer;
        },
        list: async () => ({ data: [customer], hasMore: false }),
      },
      prices: { get: async (id: string) => ({ id, productId: 'pro_fixture', status: 'active', billingCycle: { interval: 'month', frequency: 1 }, unitPrice: { amount: '1800', currencyCode: 'USD' }, trialPeriod: null }) },
      products: { get: async () => ({ id: 'pro_fixture', status: 'active' }) },
      transactions: {
        create: async (input: { customData: object }) => { saved = { id: transactionId, customerId: providerCustomer, status: 'draft', subscriptionId: null, customData: input.customData, items: [{ quantity: 1, price: { id: priceId, productId: 'pro_fixture' } }], currencyCode: 'USD', createdAt: now, updatedAt: now }; return saved; },
        get: async () => ({ ...saved, ...(controls.confirm === 'ACTIVE' ? { status: 'completed', subscriptionId: providerSubscription } : {}) }),
        update: async () => { throw new Error('Replacement is covered by SQL42'); },
        list: async () => ({ data: saved ? [saved] : [], hasMore: false }),
      },
      subscriptions: { get: async () => ({ id: providerSubscription, customerId: providerCustomer, status: 'active', items: [{ quantity: 1, recurring: true, price: { id: priceId, productId: 'pro_fixture' } }], currentBillingPeriod: { startsAt: new Date(Date.now() - 60000).toISOString(), endsAt: new Date(Date.now() + 86400000).toISOString() }, createdAt: now, updatedAt: now, scheduledChange: null, canceledAt: null, pausedAt: null }) },
    };
    service = {
      lifecycle: () => lifecycle.getBillingLifecycle(actor),
      checkout: selection => lifecycle.createBillingCheckout(actor, selection, { provider }),
      confirm: () => confirmation.confirmBillingCheckout(actor, { provider }),
      reconcile: async () => ({ outcome: await reconciliation.reconcileBillingReservations(actor, { provider }), lifecycle: await lifecycle.getBillingLifecycle(actor) }),
      close: () => prisma.$disconnect(),
    };
    return service;
  };
  const read = async () => {
    if (options.persisted) return (await services()).lifecycle();
    if (!base) {
      const response = await page.request.get(backend + '/api/subscription/manage/lifecycle');
      expect(response.status()).toBe(200);
      base = (await response.json()).data;
    }
    return { ...base, ...facts };
  };
  await page.route('**/api/subscription/manage/lifecycle', async route => {
    controls.reads++;
    if (controls.lifecycle === 'fail') return route.fulfill({ status: 503, json: { message: 'Synthetic unavailable' } });
    if (controls.lifecycle === 'denied') return route.fulfill({ status: 403, json: { message: 'Denied' } });
    return route.fulfill({ json: { data: await read() } });
  });
  await page.route('**/api/subscription/manage/catalog', route => controls.catalog === 'error'
    ? route.fulfill({ status: 503, json: { message: 'Unavailable' } })
    : route.fulfill({ json: { data: controls.catalog === 'empty' ? [] : controls.catalog === 'partial' ? catalog.filter(row => row.plan === 'PRO' && row.interval === 'year') : catalog } }));
  await page.route('**/api/subscription/manage/checkout', async route => {
    controls.posts++;
    const selection = route.request().postDataJSON() as { plan: string; interval: string };
    if (options.persisted) {
      try {
        const result = await (await services()).checkout(selection);
        drafts.push({ id: result.transactionId, ...selection, status: 'draft' });
        return route.fulfill({ json: { data: result } });
      } catch (error) {
        const failure = error as { statusCode?: number; message?: string; errors?: unknown[] };
        return route.fulfill({ status: failure.statusCode ?? 503, json: { message: failure.message ?? 'Synthetic provider boundary unavailable', errors: failure.errors ?? [] } });
      }
    }
    if (controls.checkout === '409') return route.fulfill({ status: 409, json: { message: 'Pending' } });
    const previous = drafts.at(-1);
    if (previous?.status === 'paid') {
      facts.onboardingStep = 'CONFIRMING'; facts.checkoutResume = null;
      return route.fulfill({ status: 409, json: { message: 'Checkout already paid' } });
    }
    const same = previous?.plan === selection.plan && previous.interval === selection.interval;
    if (previous && !same) previous.status = 'canceled';
    const id = same ? previous.id : drafts.length ? 'txn_' + 'c'.repeat(26) : transactionId;
    if (!same) drafts.push({ id, ...selection, status: 'draft' });
    facts.providerState = 'AWAITING_PROVIDER'; facts.checkoutResume = { ...selection, transactionId: id }; facts.onboardingStep = 'PAYMENT';
    if (controls.checkout === 'lost') return route.abort('failed');
    return route.fulfill({ json: { data: { transactionId: id, reused: !!same, replaced: !!previous && !same } } });
  });
  await page.route('**/api/subscription/manage/checkout/confirm', async route => {
    controls.confirms++;
    if (options.persisted) return route.fulfill({ json: { data: await (await services()).confirm() } });
    return route.fulfill({ json: { data: { outcome: controls.confirm, lifecycle: await read() } } });
  });
  await page.route('**/api/subscription/manage/checkout/reconcile', async route => {
    controls.reconciles++;
    if (options.persisted) return route.fulfill({ json: { data: await (await services()).reconcile() } });
    return route.fulfill({ json: { data: { outcome: controls.reconcile, lifecycle: await read() } } });
  });
  await page.route('https://cdn.paddle.com/**', route => controls.sdk === 'fail' ? route.abort('failed') : route.fulfill({
    contentType: 'application/javascript', body: `
    window.billingThrow=${controls.sdk === 'throw'};
    window.PaddleBillingV1={Environment:{set(){}},Initialize(o){this.Initialized=true;window.billingEvent=o.eventCallback;},Checkout:{
      close(){document.querySelector('[data-fixture-frame]')?.remove();},open(o){
        if(window.billingThrow)throw Error('Synthetic inline open failure');
        window.billingOpen=o;window.billingOpens=(window.billingOpens||0)+1;
        const target=document.getElementsByClassName(o.settings.frameTarget)[0];
        if(!target)throw Error('Inline target absent');
        const frame=document.createElement('iframe');frame.dataset.fixtureFrame='true';frame.title='Controlled Paddle card form';
        frame.style='width:100%;height:450px;border:0';
        frame.srcdoc='<html><body style="margin:8px;font:16px sans-serif"><label>Cardholder name<input aria-label="Cardholder name"></label><button>Pay 4242</button><button>Decline</button><button>3D Secure</button><footer>Paddle secure checkout · Terms · Privacy</footer></body></html>';
        frame.onload=()=>{const d=frame.contentDocument;
          d.querySelectorAll('button')[0].onclick=()=>window.billingEvent({name:'checkout.completed',data:{transaction_id:o.transactionId}});
          d.querySelectorAll('button')[1].onclick=()=>window.billingEvent({name:'checkout.payment.failed',data:{transaction_id:o.transactionId}});
          d.querySelectorAll('button')[2].onclick=()=>{window.billingEvent({name:'checkout.payment.initiated',data:{transaction_id:o.transactionId}});const challenge=d.createElement('button');challenge.textContent='Approve bank challenge';challenge.onclick=()=>window.billingEvent({name:'checkout.completed',data:{transaction_id:o.transactionId}});d.body.append(challenge);};
          ${controls.loaded ? "window.billingEvent({name:'checkout.loaded',data:{transaction_id:o.transactionId,currency_code:'USD',totals:{subtotal:18,tax:0,total:18,discount:0},recurring_totals:{subtotal:18,tax:0,total:18,discount:0}}});" : ''}
        };target.append(frame);
      }}};`,
  }));
  const emit = async (name: string, flat = false) => page.evaluate(({ name, flat, id }) => {
    (window as unknown as { billingEvent?: (event: unknown) => void }).billingEvent?.(flat
      ? { name, code: 'no_payment_methods', detail: 'Synthetic safe failure' }
      : { name, data: { transaction_id: id } });
  }, { name, flat, id: drafts.at(-1)?.id ?? transactionId });
  return { facts, controls, catalog, transactionId, drafts, emit, read, dispose: async () => { await service?.close(); } };
}
