import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { translate } from '../../src/i18n/translations';
import { StaffApi, fixture } from './api';

export { expect };
export type Language = 'en' | 'ur';

/** Urdu for an English key, from the app's own dictionary; fails loudly if the key has no Urdu. */
export function ur(english: string, values?: Record<string, string | number>): string {
  const text = translate(english, 'ur', values);
  if (text === translate(english, 'en', values)) throw new Error(`No Urdu for "${english}"`);
  return text;
}

/** Fixed instants on 2026-11-12 (Asia/Karachi is UTC+5; the shift runs 09:00 to 17:00 there). */
export const at = (hhmmUtc: string) => `2026-11-12T${hhmmUtc}:00.000Z`;

type OpenOptions = {
  /** ISO instant the page's clock is fixed to. Default: 11:00 in Karachi. */
  now?: string;
  language?: Language;
  /** Seed a stored staff session (the app then confirms it with get-current-user). Default true. */
  signedIn?: boolean;
  path?: string;
};

type Fixtures = {
  api: StaffApi;
  /** Seeds storage and the clock once per tab, then loads the app. */
  open: (options?: OpenOptions) => Promise<void>;
};

export const test = base.extend<Fixtures>({
  api: async ({ page }, use) => {
    const api = new StaffApi();
    await api.install(page);
    await use(api);
    expect(api.blocked, 'requests to hosts other than loopback and the fixture API').toEqual([]);
  },
  open: async ({ page, api }, use) => {
    void api;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(async ({ now = at('06:00'), language = 'en', signedIn = true, path = '/' } = {}) => {
      await page.clock.setFixedTime(new Date(now));
      const session = signedIn
        ? { user: fixture('current-user').data, accessToken: 'e2e-fixture-access', refreshToken: 'e2e-fixture-refresh', passwordChangeRequired: false }
        : null;
      // Seed once per tab, so a reload keeps whatever the app itself stored since.
      await page.addInitScript(({ session, language }) => {
        if (sessionStorage.getItem('e2e-seeded')) return;
        sessionStorage.setItem('e2e-seeded', '1');
        localStorage.clear();
        if (session) localStorage.setItem('@cleanops-staff/auth', JSON.stringify(session));
        if (language === 'ur') localStorage.setItem('hygene-ops.language', 'ur');
      }, { session, language });
      await page.goto(path);
    });
    expect(errors, 'uncaught page errors').toEqual([]);
  },
});

const MARKS = '[\u2066-\u2069]*';
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Matches visible text that the app wrote with Unicode isolation marks around entered names and
 * times (`isolate()` in StaffText). `whole` anchors the match to the full text.
 */
export function words(text: string, whole = true): RegExp {
  const body = [...text].map(escape).join(MARKS);
  return new RegExp(whole ? `^${MARKS}${body}${MARKS}$` : body);
}

/** A bottom tab by its visible label (its accessible name also carries the badge). */
export const tab = (page: Page, name: string): Locator => page.getByRole('tab').filter({ hasText: name });

/** A button by its accessible name; the last match is the one on top (stack screens keep the screen below mounted). */
export const button = (page: Page, name: string | RegExp): Locator =>
  page.getByRole('button', { name, exact: typeof name === 'string' }).last();

/** My day's sentence (title and sub line). */
export const daySentence = (page: Page) => ({
  title: page.getByTestId('day-header-title'),
  sub: page.getByTestId('day-header-sub'),
});

/**
 * Turns the network off or on. Chromium does not fire `navigator.connection` change events for an
 * emulated network change, and NetInfo's web module listens only to that event when it exists, so
 * the change is announced the way a real connection change would be.
 */
export async function setNetwork(page: Page, online: boolean): Promise<void> {
  await page.context().setOffline(!online);
  await page.evaluate(() => {
    const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
    if (connection) connection.dispatchEvent(new Event('change'));
    window.dispatchEvent(new Event(navigator.onLine ? 'online' : 'offline'));
  });
}

/**
 * Nothing is wider than the viewport: the document does not scroll sideways, and no visible text
 * runs past either edge (text inside a sideways scroller, such as the History filter chips, may).
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const width = window.innerWidth;
    const scrollsSideways = (element: Element | null): boolean => {
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (node.getAttribute('aria-hidden') === 'true') return true;
        if (['auto', 'scroll'].includes(style.overflowX) && node.scrollWidth > node.clientWidth) return true;
      }
      return false;
    };
    const outside: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(text);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width === 0 || rect.height === 0) continue;
        if ((rect.left < -1 || rect.right > width + 1) && !scrollsSideways(text.parentElement)) {
          outside.push(`${text.textContent.trim().slice(0, 40)} [${Math.round(rect.left)}, ${Math.round(rect.right)}]`);
        }
      }
    }
    return { width, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, outside };
  });
  expect(result.document, 'document width').toBeLessThanOrEqual(result.width);
  expect(result.body, 'body width').toBeLessThanOrEqual(result.width);
  expect(result.outside, 'text past the viewport edge').toEqual([]);
}
