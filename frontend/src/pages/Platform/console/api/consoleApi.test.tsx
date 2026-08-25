import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { operatorQueryScope, operatorRequest } from '../../operatorSession';
import {
  getConsoleCompanies,
  getConsoleCompanyInsights,
  getConsoleOverview,
  getConsolePayments,
  getConsoleSubscriptions,
} from './consoleApi';
import {
  useConsoleCompanies,
  useConsoleCompanyInsights,
  useConsoleOverview,
  useConsolePayments,
  useConsoleSubscriptions,
} from './consoleQueries';

vi.mock('../../operatorSession', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../operatorSession')>(),
  operatorRequest: vi.fn(),
}));

const request = vi.mocked(operatorRequest);
const companyFilters = {
  q: 'A & B', status: 'SUSPENDED', after: 'next+/=', plan: 'PRO', subscription: 'PAST_DUE',
} as const;
const subscriptionFilters = { status: 'SCHEDULED_CANCEL', cursor: 'next+/=' } as const;
const paymentFilters = { range: 'three', cursor: 'next+/=' } as const;

function createQueryWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: 0 } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, Wrapper };
}

beforeEach(() => {
  request.mockReset();
});

describe('console API', () => {
  it.each([
    { path: '/platform/overview', fetch: getConsoleOverview },
    {
      path: '/platform/companies?q=A+%26+B&status=SUSPENDED&after=next%2B%2F%3D&plan=PRO&subscription=PAST_DUE',
      fetch: (signal: AbortSignal) => getConsoleCompanies(companyFilters, signal),
    },
    { path: '/platform/companies/17/insights', fetch: (signal: AbortSignal) => getConsoleCompanyInsights(17, signal) },
    {
      path: '/platform/subscriptions?status=SCHEDULED_CANCEL&cursor=next%2B%2F%3D',
      fetch: (signal: AbortSignal) => getConsoleSubscriptions(subscriptionFilters, signal),
    },
    {
      path: '/platform/payments?range=three&cursor=next%2B%2F%3D',
      fetch: (signal: AbortSignal) => getConsolePayments(paymentFilters, signal),
    },
  ])('calls $path and returns the data payload', async ({ path, fetch }) => {
    const signal = new AbortController().signal;
    const data = {};
    request.mockResolvedValue({ data });

    await expect(fetch(signal)).resolves.toBe(data);
    expect(request).toHaveBeenCalledExactlyOnceWith(path, { signal });
  });

  it.each([
    { path: '/platform/companies', fetch: () => getConsoleCompanies({ q: '', status: '', after: '' }) },
    { path: '/platform/subscriptions?status=ACTIVE', fetch: () => getConsoleSubscriptions({ status: 'ACTIVE', cursor: '' }) },
    { path: '/platform/payments', fetch: () => getConsolePayments({ range: undefined, cursor: '' }) },
  ])('omits empty filters from $path', async ({ path, fetch }) => {
    request.mockResolvedValue({ data: {} });

    await fetch();

    expect(request).toHaveBeenCalledExactlyOnceWith(path, { signal: undefined });
  });
});

describe('console queries', () => {
  it('scopes all queries to the operator and includes filters and company ID in their keys', async () => {
    request.mockResolvedValue({ data: {} });
    const { client, Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => [
      useConsoleOverview(),
      useConsoleCompanies(companyFilters),
      useConsoleCompanyInsights(17),
      useConsoleSubscriptions(subscriptionFilters),
      useConsolePayments(paymentFilters),
    ], { wrapper: Wrapper });

    await waitFor(() => expect(result.current.every((query) => query.isSuccess)).toBe(true));

    const keys = client.getQueryCache().findAll({ queryKey: operatorQueryScope }).map(({ queryKey }) => queryKey);
    const scope = [...operatorQueryScope, 'console'];
    expect(keys).toHaveLength(5);
    expect(keys).toEqual(expect.arrayContaining([
      [...scope, 'overview'],
      [...scope, 'companies', companyFilters],
      [...scope, 'company-insights', 17],
      [...scope, 'subscriptions', subscriptionFilters],
      [...scope, 'payments', paymentFilters],
    ]));
    expect(request).toHaveBeenCalledTimes(5);
    for (const [, options] of request.mock.calls) {
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it.each([401, 403])('surfaces HTTP %i without retrying', async (status) => {
    const error = Object.assign(new Error('Platform request failed'), { status });
    request.mockRejectedValue(error);
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useConsoleOverview(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
