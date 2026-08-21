import { describe, expect, it } from 'vitest';
import type { BillingOnboardingStep } from '../Subscription/types';
import { ONBOARDING_ROUTES, isSafeFromPath, onboardingRouteForStep, parseOnboardingQuery } from './onboardingRoutes';

describe('onboarding route map', () => {
  const destinations = {
    CHOOSE_PLAN: '/choose-plan',
    PAYMENT: '/subscription/payment',
    CONFIRMING: '/subscription/activation',
    WORKSPACE: '/dashboard',
    ACCOUNT: '/subscription',
    RECONCILE: '/subscription/recovery',
    RESTRICTED: '/subscription/recovery',
    VERIFY_EMAIL: '/account/security',
    UNAVAILABLE: '/subscription/recovery',
  } satisfies Record<BillingOnboardingStep, string>;

  it.each(Object.entries(destinations))('maps %s to %s', (step, route) => {
    expect(onboardingRouteForStep(step as BillingOnboardingStep)).toBe(route);
  });

  it('exports the entry and public auth destinations', () => {
    expect(ONBOARDING_ROUTES).toMatchObject({ continue: '/continue', login: '/login', signup: '/signup' });
  });

  it.each([null, undefined])('does not invent a route for missing step %s', step => {
    expect(onboardingRouteForStep(step)).toBeNull();
  });

  it('fails closed if unparsed runtime input reaches the exhaustive map', () => {
    expect(onboardingRouteForStep('PAID' as BillingOnboardingStep)).toBeNull();
  });
});

describe('onboarding query allowlist', () => {
  it.each(['STARTER', 'PRO', 'ADVANCED'])('preserves %s with either supported interval', plan => {
    for (const interval of ['month', 'year']) {
      expect(parseOnboardingQuery(`?plan=${plan}&interval=${interval}`)).toEqual({ plan, interval });
    }
  });

  it.each(['', 'starter', 'pro', 'ENTERPRISE', 'FREE', 'null', 'undefined', '0', 'PRO ', ' PRO', 'PRO,ADVANCED', '<script>'])('drops invalid plan %j independently of interval', plan => {
    expect(parseOnboardingQuery(new URLSearchParams({ plan, interval: 'year' }))).toEqual({ interval: 'year' });
  });

  it.each(['', 'Month', 'YEAR', 'monthly', 'yearly', 'day', 'null', 'undefined', '0', 'month ', ' year', 'month,year'])('drops invalid interval %j independently of plan', interval => {
    expect(parseOnboardingQuery(new URLSearchParams({ plan: 'PRO', interval }))).toEqual({ plan: 'PRO' });
  });

  it.each(['', '?', '?plan=FREE&interval=day', '?PLAN=PRO&INTERVAL=year'])('returns no selection for %j', search => {
    expect(parseOnboardingQuery(search)).toEqual({});
  });

  it('drops every unrelated key without changing the caller params', () => {
    const params = new URLSearchParams('plan=ADVANCED&interval=year&from=//evil.example&companyId=99&paid=true&transactionId=txn_fake');
    const before = params.toString();
    expect(parseOnboardingQuery(params)).toEqual({ plan: 'ADVANCED', interval: 'year' });
    expect(params.toString()).toBe(before);
  });

  it.each([
    ['plan=PRO&plan=STARTER&interval=month', { interval: 'month' }],
    ['plan=PRO&plan=PRO&interval=month', { interval: 'month' }],
    ['plan=PRO&plan=FREE&interval=month', { interval: 'month' }],
    ['plan=PRO&interval=month&interval=year', { plan: 'PRO' }],
    ['plan=PRO&interval=month&interval=month', { plan: 'PRO' }],
    ['plan=PRO&interval=bogus&interval=year', { plan: 'PRO' }],
    ['plan=PRO&plan=STARTER&interval=month&interval=year', {}],
  ])('drops ambiguous repeated values in %s', (search, expected) => {
    expect(parseOnboardingQuery(search)).toEqual(expected);
  });

  it('uses URL decoding once before exact allowlist matching', () => {
    expect(parseOnboardingQuery('plan=%50RO&interval=%79ear')).toEqual({ plan: 'PRO', interval: 'year' });
    expect(parseOnboardingQuery('plan=%2550RO&interval=%2579ear')).toEqual({});
  });
});

describe('safe from deep links', () => {
  it.each([
    '/', '/dashboard', '/dashboard?date=2026-11-09#tasks', '/locations/42',
    '/staff/7?month=2026-11', '/exceptions/9?returnTo=%2Fdashboard', '/settings',
    '/locations/%D8%B5%D9%81%D8%A7%D8%A6%DB%8C', '/locations/caf%C3%A9',
    '/locations/a%20b', '/dashboard?search=two%20words', '/@evil.example',
    '/dashboard?next=https://evil.example', '/dashboard#//evil.example',
    '/login-history', '/signup-report', '/subscription-history', '/choose-plans',
    '/continue-report', '/welcome-back', '/account/security-log',
  ])('accepts internal destination %j', path => {
    expect(isSafeFromPath(path)).toBe(true);
  });

  it.each([
    null, undefined, 0, true, {}, [], new URL('https://evil.example'),
    '', 'dashboard', '?from=/dashboard', '#dashboard',
    'https://evil.example/dashboard', 'https://onboarding.invalid/dashboard',
    'http://evil.example', 'javascript:alert(1)', 'data:text/html,hello',
    '//evil.example', '///evil.example', '/\\evil.example', '\\evil.example',
    '/dashboard\\..\\login', ' /dashboard', '/dashboard ',
    `/\t/evil.example`, `/\n/evil.example`, `/\r/evil.example`,
    `/dashboard${String.fromCharCode(0)}`, `/dashboard${String.fromCharCode(127)}`,
    '/%2Fevil.example', '/%2f%2fevil.example', '/%5Cevil.example',
    '/%252fevil.example', '/dashboard%3Fnext=evil', '/dashboard%23login',
    '/%', '/%zz', '/%C0%AF', '/%E0%A4%A', '/%00dashboard', '/%09/evil.example',
    '/x/..//evil.example', '/%2e//evil.example',
  ])('rejects external, malformed or ambiguous destination %j', path => {
    expect(isSafeFromPath(path)).toBe(false);
  });

  const excludedPaths = [
    '/login', '/signup', '/continue', '/choose-plan', '/subscription',
    '/subscription/payment', '/subscription/activation', '/subscription/recovery',
    '/welcome', '/account/security', '/recover-owner-account', '/verify-owner-email',
    '/reset-owner-password', '/platform/login', '/platform/callback', '/platform/security',
  ];
  it.each(excludedPaths)('rejects auth or billing destination %s, with query, fragment or descendants', path => {
    for (const candidate of [path, `${path}/`, `${path}?from=/dashboard`, `${path}#ready`, `${path}/nested`, path.toUpperCase()]) {
      expect(isSafeFromPath(candidate), candidate).toBe(false);
    }
  });

  it.each([
    '/%6cogin', '/%73ignup', '/%63ontinue', '/choose-%70lan', '/sub%73cription/payment',
    '/account/%73ecurity', '/%2573ubscription', '/dashboard/../login',
    '/dashboard/%2e%2e/choose-plan', '/locations/../../subscription/activation',
  ])('rejects encoded and normalized auth/setup bypass %j', path => {
    expect(isSafeFromPath(path)).toBe(false);
  });
});
