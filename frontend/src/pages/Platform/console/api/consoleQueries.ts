import { useQuery } from '@tanstack/react-query';
import { operatorQueryScope } from '../../operatorSession';
import {
  getConsoleCompanies,
  getConsoleCompanyInsights,
  getConsoleOverview,
  getConsolePayments,
  getConsoleSubscriptions,
  type ConsoleCompanyFilters,
  type ConsolePaymentFilters,
  type ConsoleSubscriptionFilters,
} from './consoleApi';

const scope = [...operatorQueryScope, 'console'] as const;

function retry(failureCount: number, error: Error) {
  if ('status' in error && (error.status === 401 || error.status === 403)) return false;
  return failureCount < 3;
}

export function useConsoleOverview() {
  return useQuery({
    queryKey: [...scope, 'overview'],
    queryFn: ({ signal }) => getConsoleOverview(signal),
    retry,
  });
}

export function useConsoleCompanies(filters: ConsoleCompanyFilters = {}) {
  return useQuery({
    queryKey: [...scope, 'companies', filters],
    queryFn: ({ signal }) => getConsoleCompanies(filters, signal),
    retry,
  });
}

export function useConsoleCompanyInsights(id: number) {
  return useQuery({
    queryKey: [...scope, 'company-insights', id],
    queryFn: ({ signal }) => getConsoleCompanyInsights(id, signal),
    retry,
  });
}

export function useConsoleSubscriptions(filters: ConsoleSubscriptionFilters = {}) {
  return useQuery({
    queryKey: [...scope, 'subscriptions', filters],
    queryFn: ({ signal }) => getConsoleSubscriptions(filters, signal),
    retry,
  });
}

export function useConsolePayments(filters: ConsolePaymentFilters = {}) {
  return useQuery({
    queryKey: [...scope, 'payments', filters],
    queryFn: ({ signal }) => getConsolePayments(filters, signal),
    retry,
  });
}
