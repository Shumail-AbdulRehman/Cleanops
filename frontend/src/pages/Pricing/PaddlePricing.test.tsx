import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { LanguageContext } from '@/i18n/context';
import { translate } from '@/i18n/translations';
import { WorkspaceLink } from '@/components/marketing/MarketingCTA';
import { PaddlePricing } from './PaddlePricing';
import PricingPage from './PricingPage';
import { client } from '@/api/client';
import { getPublicPlanPrices, type PublicPlanPrice } from '../Subscription/api';
import * as queries from '../Subscription/queries';

const mocks = vi.hoisted(() => ({
  user: null as null | { role: string },
  catalog: { data: [] as { plan: string; interval: string }[], isPending: false, isError: false },
  readCatalog: vi.fn(),
  prices: { data: undefined as PublicPlanPrice[] | undefined, isPending: true, isError: false },
  readPrices: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ default: () => ({ user: mocks.user, isAuthenticated: !!mocks.user }) }));
vi.mock('../Subscription/queries', () => ({
  useBillingCatalog: () => { mocks.readCatalog(); return mocks.catalog; },
  usePublicPlanPrices: () => mocks.readPrices(),
}));

beforeEach(() => {
  mocks.user = null;
  mocks.catalog = { data: [], isPending: false, isError: false };
  mocks.readCatalog.mockClear();
  mocks.prices = { data: undefined, isPending: true, isError: false };
  mocks.readPrices.mockReset().mockImplementation(() => mocks.prices);
});

const publicPrices: PublicPlanPrice[] = [
  { plan: 'STARTER', interval: 'month', amount: '1234', currencyCode: 'USD' },
  { plan: 'STARTER', interval: 'year', amount: '12345', currencyCode: 'USD' },
  { plan: 'PRO', interval: 'month', amount: '4567', currencyCode: 'USD' },
  { plan: 'PRO', interval: 'year', amount: '45678', currencyCode: 'USD' },
  { plan: 'ADVANCED', interval: 'month', amount: '99999', currencyCode: 'USD' },
];
const fallbackNote = 'Prices are available from the configured catalog in owner billing. Final totals and taxes are shown at checkout. No payment starts on this page.';
const priceNote = 'Final totals and taxes are shown at checkout. No payment starts on this page.';
const planCard = (name: string) => within(screen.getByRole('heading', { name }).closest('article')!);

it.each(['en', 'ur'] as const)('shows both selected-interval prices and keeps Enterprise unpriced in %s', language => {
  mocks.prices = { data: publicPrices, isPending: false, isError: false };
  mount({}, language);
  const locale = language === 'ur' ? 'ur-PK' : 'en-PK';
  for (const interval of ['month', 'year', 'month'] as const) {
    fireEvent.click(screen.getByRole('radio', { name: translate(interval === 'month' ? 'Monthly' : 'Yearly', language) }));
    for (const [name, code] of [['Starter', 'STARTER'], ['Pro', 'PRO']]) {
      const entry = publicPrices.find(price => price.plan === code && price.interval === interval)!;
      const formatted = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(Number(entry.amount) / 100);
      expect(planCard(name).getByText(formatted, { exact: true })).toBeVisible();
      expect(planCard(name).getByText(translate(interval === 'month' ? '/ month' : '/ year', language))).toBeVisible();
    }
    expect(planCard('Enterprise').getByRole('button', { name: 'Contact sales' })).toBeVisible();
    expect(planCard('Enterprise').queryByText(/999|USD|US\$/)).not.toBeInTheDocument();
  }
  expect(screen.getByText(translate(priceNote, language), { exact: true })).toBeVisible();
  expect(screen.queryByText(translate(fallbackNote, language))).not.toBeInTheDocument();
  expect(mocks.readCatalog).not.toHaveBeenCalled();
});

it.each([
  ['JPY', '1234', 1234], ['KWD', '1234', 1.234], ['USD', '0', 0],
] as const)('uses %s minor units rather than assuming cents', (currencyCode, amount, major) => {
  mocks.prices = { data: [{ plan: 'STARTER', interval: 'month', amount, currencyCode }], isPending: false, isError: false };
  mount();
  expect(planCard('Starter').getByText(new Intl.NumberFormat('en-PK', { style: 'currency', currency: currencyCode }).format(major).replace(/\s/g, ' '))).toBeVisible();
  expect(planCard('Pro').queryByText('/ month')).not.toBeInTheDocument();
});

it('keeps a large minor-unit integer exact through the existing formatter', () => {
  mocks.prices = { data: [{ plan: 'STARTER', interval: 'month', amount: '900719925474099399', currencyCode: 'USD' }], isPending: false, isError: false };
  mount();
  expect(planCard('Starter').getByText('US$9,007,199,254,740,993.99')).toBeVisible();
});

it.each(['en', 'ur'] as const)('announces quiet loading and retains the fallback note in %s', language => {
  const { container, rerender } = mount({}, language);
  expect(screen.getByRole('status')).toHaveTextContent(translate('Loading plan prices…', language));
  const slots = [...container.querySelectorAll<HTMLElement>('.hx-plan-price')];
  expect(slots).toHaveLength(2);
  const heights = slots.map(slot => slot.style.minBlockSize);
  for (const slot of slots) {
    expect(slot.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(slot).toHaveTextContent('');
  }
  expect(screen.getByText(translate(fallbackNote, language))).toBeVisible();
  mocks.prices = { data: publicPrices, isPending: false, isError: false };
  rerender(<MemoryRouter><LanguageContext.Provider value={{ language, setLanguage: () => {}, t: (key, values) => translate(key, language, values) }}><PaddlePricing /></LanguageContext.Provider></MemoryRouter>);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect([...container.querySelectorAll<HTMLElement>('.hx-plan-price')].map(slot => slot.style.minBlockSize)).toEqual(heights);
});

it.each(['en', 'ur'] as const)('hides amounts after a failed read, including cached amounts, in %s', language => {
  mocks.prices = { data: publicPrices, isPending: false, isError: true };
  const { container } = mount({}, language);
  for (const slot of container.querySelectorAll('.hx-plan-price')) expect(slot).toBeEmptyDOMElement();
  expect(screen.getByText(translate(fallbackNote, language))).toBeVisible();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Contact sales' })).toBeVisible();
  expect(screen.getAllByRole('link')).toHaveLength(2);
});

it('reads the public endpoint with cancellation and shares its query cache without an owner', async () => {
  const realQueries = await vi.importActual<typeof queries>('../Subscription/queries');
  mocks.readPrices.mockImplementation(realQueries.usePublicPlanPrices);
  const get = vi.spyOn(client, 'get').mockResolvedValue({ data: { data: publicPrices } });
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = <QueryClientProvider client={query}><MemoryRouter><PaddlePricing /></MemoryRouter></QueryClientProvider>;
  const first = render(tree);
  await waitFor(() => expect(planCard('Starter').getByText('US$12.34')).toBeVisible());
  expect(get).toHaveBeenCalledExactlyOnceWith('/subscription/prices', { signal: expect.any(AbortSignal) });
  first.unmount();
  const second = render(tree);
  expect(planCard('Pro').getByText('US$45.67')).toBeVisible();
  expect(get).toHaveBeenCalledOnce();
  expect(mocks.readCatalog).not.toHaveBeenCalled();
  second.unmount(); query.clear(); get.mockRestore();
});

it.each([null, {}, [], [{ plan: 'PRO', interval: 'month', amount: 'invalid', currencyCode: 'USD' }]])('rejects an unusable public response %#', async data => {
  const get = vi.spyOn(client, 'get').mockResolvedValue({ data: { data } });
  try { await expect(getPublicPlanPrices()).rejects.toThrow('Plan prices are unavailable'); }
  finally { get.mockRestore(); }
});
function mount(props: Parameters<typeof PaddlePricing>[0] = {}, language: 'en' | 'ur' = 'en', page = false) {
  return render(<MemoryRouter><LanguageContext.Provider value={{ language, setLanguage: () => {}, t: (key, values) => translate(key, language, values) }}>{page ? <PricingPage /> : <PaddlePricing {...props} />}</LanguageContext.Provider></MemoryRouter>);
}

it.each(['month', 'year'] as const)('carries each public plan and the %s interval into signup', interval => {
  mount();
  if (interval === 'year') fireEvent.click(screen.getByRole('radio', { name: 'Yearly' }));
  for (const [name, code] of [['Starter', 'STARTER'], ['Pro', 'PRO']]) {
    expect(screen.getByRole('link', { name: `Choose ${name}` })).toHaveAttribute('href', `/signup?plan=${code}&interval=${interval}`);
  }
  expect(screen.getAllByRole('link')).toHaveLength(2);
  expect(mocks.readCatalog).not.toHaveBeenCalled();
});
it('updates both plan links when switching the interval back to monthly', () => {
  mount(); fireEvent.click(screen.getByRole('radio', { name: 'Yearly' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Monthly' }));
  expect(screen.getByRole('radio', { name: 'Monthly' })).toBeChecked();
  expect(screen.getAllByRole('link').every(link => link.getAttribute('href')?.endsWith('interval=month'))).toBe(true);
});
it('sends signed-in owners through the server next-step resolver', () => {
  mocks.user = { role: 'ADMIN' }; mount();
  expect(screen.getAllByRole('link')).toHaveLength(2);
  for (const link of screen.getAllByRole('link')) expect(link).toHaveAttribute('href', '/continue');
});
it.each(['MANAGER', 'STAFF'])('offers no purchase link to %s', role => {
  mocks.user = { role }; mount();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.getAllByText('Only the company owner can view or change billing.')).toHaveLength(2);
  expect(mocks.readCatalog).not.toHaveBeenCalled();
});
it('respects the parent purchase restriction and message', () => {
  mocks.user = { role: 'ADMIN' }; mount({ subscribeDisabled: true, disabledMessage: 'Billing unavailable' });
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.getAllByText('Billing unavailable')).toHaveLength(2);
  expect(mocks.readCatalog).not.toHaveBeenCalled();
});
it.each(['month', 'year'])('offers Enterprise self-serve only for a catalog-backed %s interval', interval => {
  mocks.user = { role: 'ADMIN' };
  mocks.catalog.data = [{ plan: 'ADVANCED', interval }];
  mount({ currentPlan: 'ADVANCED' });
  if (interval === 'year') fireEvent.click(screen.getByRole('radio', { name: 'Yearly' }));
  const enterprise = screen.getByRole('heading', { name: 'Enterprise' }).closest('article')!;
  expect(within(enterprise).getByRole('link')).toHaveAttribute('href', '/continue');
  expect(within(enterprise).getByText('Current capacity plan')).toBeVisible();
  fireEvent.click(screen.getByRole('radio', { name: interval === 'month' ? 'Yearly' : 'Monthly' }));
  expect(within(enterprise).queryByRole('link')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Contact sales' })).toBeVisible();
});
it.each(['empty', 'pending', 'error'])('keeps the Enterprise inquiry for an %s catalog', state => {
  mocks.user = { role: 'ADMIN' };
  if (state !== 'empty') mocks.catalog.data = [{ plan: 'ADVANCED', interval: 'month' }];
  mocks.catalog.isPending = state === 'pending'; mocks.catalog.isError = state === 'error';
  mount();
  expect(screen.getByRole('button', { name: 'Contact sales' })).toBeVisible();
  expect(screen.getAllByRole('link')).toHaveLength(2);
});
it.each(['en', 'ur'] as const)('renders no promotional trial wording in %s', language => {
  const { container } = mount({}, language);
  expect(container.textContent).not.toMatch(/trial|آزمائشی\s+مدت|مفت\s+آزمائش/iu);
});
it('preserves the historical Trialing status translation', () => {
  expect(translate('Trialing', 'en')).toBe('Trialing');
  expect(translate('Trialing', 'ur')).toBe('آزمائشی مدت جاری');
});
it.each([false, true])('routes the marketing CTA with authenticated=%s', authenticated => {
  mocks.user = authenticated ? { role: 'ADMIN' } : null;
  render(<MemoryRouter><WorkspaceLink /></MemoryRouter>);
  expect(screen.getByRole('link')).toHaveAttribute('href', authenticated ? '/continue' : '/signup');
});

it.each([null, 'ADMIN', 'MANAGER', 'STAFF'])('keeps the full pricing page accurate for role=%s', role => {
  mocks.user = role ? { role } : null;
  mocks.catalog.data = [{ plan: 'ADVANCED', interval: 'month' }];
  const { container } = mount({}, 'en', true);
  expect(container.textContent).not.toMatch(/trial/iu);
  expect(screen.getByText(/Enterprise checkout is available in owner billing when the configured catalog includes it/)).toBeInTheDocument();
  if (!role) {
    expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/signup');
    expect(screen.getByRole('link', { name: 'Choose Starter' })).toHaveAttribute('href', '/signup?plan=STARTER&interval=month');
    expect(screen.getByRole('link', { name: 'Choose Pro' })).toHaveAttribute('href', '/signup?plan=PRO&interval=month');
    expect(mocks.readCatalog).not.toHaveBeenCalled();
  } else {
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(role === 'ADMIN' ? 4 : 1);
    for (const link of links) expect(link).toHaveAttribute('href', '/continue');
    if (role !== 'ADMIN') {
      expect(screen.getAllByText('Only the company administrator can subscribe for this workspace.')).toHaveLength(2);
      expect(mocks.readCatalog).not.toHaveBeenCalled();
    }
  }
});
