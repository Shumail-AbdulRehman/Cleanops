import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LanguageContext } from '@/i18n/context';
import { translate } from '@/i18n/translations';
import OrderSummary, { type OrderSummaryProps } from './OrderSummary';

const defaults: OrderSummaryProps = {
  plan: { name: 'Pro', limits: { locations: 5, staff: 25, managers: 3 } }, interval: 'month',
  catalogPrice: { amount: '2500', currencyCode: 'USD', interval: 'month' },
};
const totals = { currencyCode: 'USD', totals: { subtotal: '2800', tax: '420', total: '3220' }, recurringTotals: { total: '3450' } };
function view(props: Partial<OrderSummaryProps> = {}, language: 'en' | 'ur' = 'en') {
  return render(<MemoryRouter><LanguageContext.Provider value={{ language, setLanguage: () => {}, t: (key, values) => translate(key, language, values) }}>
    <OrderSummary {...defaults} {...props} />
  </LanguageContext.Provider></MemoryRouter>);
}
const row = (label: string) => screen.getByText(label).closest('div')!;

describe('OrderSummary', () => {
  it('shows four skeletons until provider totals arrive, without displaying the catalog as a total', () => {
    const { container } = view();
    expect(screen.getAllByRole('status', { name: 'Loading…' })).toHaveLength(4);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByText(/\$|0\.00/)).not.toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Monthly')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
  });
  it('renders distinct provider subtotal, tax, total and renewal without using the catalog', () => {
    view({ totals });
    expect(within(row('Subtotal')).getByText('US$28.00')).toBeInTheDocument();
    expect(within(row('Tax')).getByText('US$4.20')).toBeInTheDocument();
    expect(within(row('Due today')).getByText('US$32.20')).toBeInTheDocument();
    expect(screen.getByText('US$34.50').parentElement).toHaveTextContent('per month');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('US$25.00')).not.toBeInTheDocument();
  });
  it('uses the catalog recurring price only in fallback and never invents tax or due today', () => {
    view({ fallback: true });
    for (const label of ['Subtotal', 'Tax', 'Due today']) expect(row(label)).toHaveTextContent('Calculated by Paddle');
    expect(screen.getByText('US$25.00').parentElement).toHaveTextContent('Then renews at');
    expect(screen.queryByText('US$0.00')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('keeps received totals authoritative in fallback', () => {
    view({ totals, fallback: true });
    expect(screen.getByText('US$34.50')).toBeInTheDocument();
    expect(screen.queryByText('US$25.00')).not.toBeInTheDocument();
  });
  it('does not substitute due today for a missing renewal amount', () => {
    view({ totals: { ...totals, recurringTotals: undefined } });
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getAllByText('US$32.20')).toHaveLength(1);
  });
  it('renders provider supplied zero tax', () => {
    view({ totals: { ...totals, totals: { ...totals.totals, tax: '0' } } });
    expect(within(row('Tax')).getByText('US$0.00')).toBeInTheDocument();
  });
  it.each(['-1', '4.20', '', 'NaN'])('does not render invalid tax %s', tax => {
    view({ totals: { ...totals, totals: { ...totals.totals, tax } }, fallback: true });
    expect(row('Tax')).toHaveTextContent('Calculated by Paddle');
  });
  it('does not use a catalog price for a different interval', () => {
    view({ fallback: true, interval: 'year' });
    expect(screen.queryByText('US$25.00')).not.toBeInTheDocument();
    expect(screen.getByText('Yearly')).toBeInTheDocument();
  });
  it('does not invent a price when neither totals nor catalog are available', () => {
    const { container } = view({ fallback: true, catalogPrice: null });
    expect(container.querySelectorAll('dl bdi')).toHaveLength(0);
    expect(screen.getAllByText('Calculated by Paddle')).toHaveLength(4);
  });
  it('uses the shared formatter for a zero-decimal currency', () => {
    view({ totals: { ...totals, currencyCode: 'JPY' } });
    expect(within(row('Due today')).getByText(/3,220/)).toBeInTheDocument();
    expect(row('Due today')).not.toHaveTextContent('32.20');
  });
  it('keeps amounts unavailable when provider currency is missing or unsupported', () => {
    view({ totals: { ...totals, currencyCode: 'ZZZ' }, fallback: true, catalogPrice: null });
    expect(screen.getAllByText('Calculated by Paddle')).toHaveLength(4);
  });
  it('shows annual renewal with its full annual price', () => {
    view({ interval: 'year', totals: { ...totals, recurringTotals: { total: '30000' } } });
    expect(screen.getByText('US$300.00').parentElement).toHaveTextContent('per year');
  });
  it('links to change plan and accepts an alternate destination', () => {
    view({ changePlanHref: '/choose-plan?interval=year' });
    expect(screen.getByRole('link', { name: 'Change plan' })).toHaveAttribute('href', '/choose-plan?interval=year');
  });
  it('hides change plan during paying or replacing when requested', () => {
    view({ hideChangePlan: true });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it.each([false, true])('keeps amounts and capacity numbers left-to-right in Urdu (fallback %s)', fallback => {
    const { container } = view({ totals: fallback ? null : totals, fallback }, 'ur');
    expect(screen.getByRole('complementary')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText(translate('Tax', 'ur'))).toBeInTheDocument();
    const isolates = container.querySelectorAll('bdi');
    expect(isolates.length).toBe(fallback ? 4 : 7);
    isolates.forEach(node => expect(node).toHaveAttribute('dir', 'ltr'));
  });
  it('uses compact responsive hooks for capacities and the security note only', () => {
    const { container } = view({ totals });
    expect(container.querySelector('ul')).toHaveClass('hidden', 'min-[1024px]:flex');
    expect(screen.getByText('Your card details go straight to Paddle. We never see them.').parentElement).toHaveClass('hidden', 'min-[1024px]:flex');
    expect(screen.getByRole('complementary')).toHaveClass('min-[1024px]:sticky');
    expect(screen.getByText('Due today').closest('dl')).not.toHaveClass('hidden');
  });
});
