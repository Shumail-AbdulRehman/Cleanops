import type { BillingInterval, BillingOnboardingStep, PlanCode } from '../Subscription/types';

export const ONBOARDING_ROUTES = {
  continue: '/continue',
  login: '/login',
  signup: '/signup',
  choosePlan: '/choose-plan',
  payment: '/subscription/payment',
  activation: '/subscription/activation',
  recovery: '/subscription/recovery',
  workspace: '/dashboard',
  account: '/subscription',
  security: '/account/security',
} as const;

export type OnboardingRoute = typeof ONBOARDING_ROUTES[keyof typeof ONBOARDING_ROUTES];
export type OnboardingSelection = { plan?: PlanCode; interval?: BillingInterval };

/** Only a server step selects a destination; a missing step needs a retry. */
export function onboardingRouteForStep(step: BillingOnboardingStep | null | undefined): OnboardingRoute | null {
  switch (step) {
    case 'CHOOSE_PLAN': return ONBOARDING_ROUTES.choosePlan;
    case 'PAYMENT': return ONBOARDING_ROUTES.payment;
    case 'CONFIRMING': return ONBOARDING_ROUTES.activation;
    case 'WORKSPACE': return ONBOARDING_ROUTES.workspace;
    case 'ACCOUNT': return ONBOARDING_ROUTES.account;
    case 'RECONCILE':
    case 'RESTRICTED':
    case 'UNAVAILABLE': return ONBOARDING_ROUTES.recovery;
    case 'VERIFY_EMAIL': return ONBOARDING_ROUTES.security;
    case null:
    case undefined: return null;
    default: return unreadableStep(step);
  }
}

// Extending BillingOnboardingStep must fail type checking until the map is updated.
function unreadableStep(step: never): null {
  void step;
  return null;
}

/** Preserve only exact, unambiguous selections. Never mutate the caller's params. */
export function parseOnboardingQuery(search: string | URLSearchParams): OnboardingSelection {
  const params = new URLSearchParams(search);
  const selection: OnboardingSelection = {};
  const plans = params.getAll('plan');
  const intervals = params.getAll('interval');
  if (plans.length === 1 && (plans[0] === 'STARTER' || plans[0] === 'PRO' || plans[0] === 'ADVANCED')) {
    selection.plan = plans[0];
  }
  if (intervals.length === 1 && (intervals[0] === 'month' || intervals[0] === 'year')) {
    selection.interval = intervals[0];
  }
  return selection;
}

const INTERNAL_ORIGIN = 'https://onboarding.invalid';
const EXCLUDED_FROM_PATHS = [
  ONBOARDING_ROUTES.login,
  ONBOARDING_ROUTES.signup,
  ONBOARDING_ROUTES.continue,
  ONBOARDING_ROUTES.choosePlan,
  ONBOARDING_ROUTES.account,
  ONBOARDING_ROUTES.security,
  '/welcome',
  '/recover-owner-account',
  '/verify-owner-email',
  '/reset-owner-password',
  '/platform',
];

function hasUnsafePathCharacters(value: string): boolean {
  return value.includes('\\') || Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

/** A same-origin workspace deep link, never an auth/setup loop or an access grant. */
export function isSafeFromPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() !== value || !value.startsWith('/') || value.startsWith('//') || hasUnsafePathCharacters(value)) {
    return false;
  }
  try {
    const url = new URL(value, INTERNAL_ORIGIN);
    if (url.origin !== INTERNAL_ORIGIN || /%(?:2f|5c|25|3f|23)/i.test(url.pathname)) return false;
    const decodedPath = decodeURIComponent(url.pathname);
    if (decodedPath.startsWith('//') || hasUnsafePathCharacters(decodedPath)) return false;
    // Decode route names before matching, and normalize dot segments a second time.
    const pathname = new URL(decodedPath, INTERNAL_ORIGIN).pathname.toLowerCase();
    return !EXCLUDED_FROM_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`));
  } catch {
    return false;
  }
}
