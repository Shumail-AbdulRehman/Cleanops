import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { notifyManager, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, CreditCard, Inbox, LayoutDashboard, LogOut, Menu, RefreshCw, X } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import BrandLogo from '@/components/common/BrandLogo';
import { useLanguage } from '@/i18n/context';
import '@/workspace-tokens.css';
import { clearOperatorSession, operatorQueryScope, signOutLocalOperator } from '../../operatorSession';
import { getInquiries } from '../../serviceApi';
import '../console-tokens.css';
import './console-shell.css';

const links = [
  { to: '/platform', label: 'Overview', icon: LayoutDashboard },
  { to: '/platform/companies', label: 'Companies', icon: Building2 },
  { to: '/platform/subscriptions', label: 'Subscriptions', icon: CreditCard },
  { to: '/platform/inquiries', label: 'Inquiries', icon: Inbox },
] as const;

const drawerMedia = '(width < 860px)';
const inquiryCountKey = [...operatorQueryScope, 'inquiries', 'new-count'] as const;

async function countNewInquiries(signal: AbortSignal) {
  let count = 0;
  let after: string | undefined;
  do {
    const page = await getInquiries({ after }, signal);
    count += page.items.filter(({ handling }) => handling.status === 'NEW').length;
    after = page.nextCursor ?? undefined;
  } while (after);
  return count;
}

export type ConsoleShellProps = {
  title?: string;
  backLink?: { to: string; label: string };
  operatorEmail?: string | null;
};

export default function ConsoleShell(props: ConsoleShellProps) {
  const [signedOut, setSignedOut] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function finishSignOut() {
    // Unmount the console observers before evicting their queries and mounting the login route.
    flushSync(() => setSignedOut(true));
    await clearOperatorSession(queryClient).catch(() => undefined);
    navigate('/platform/login', { replace: true });
  }

  return signedOut ? null : <ConsoleShellContent {...props} onSignedOut={finishSignOut} />;
}

function ConsoleShellContent({ title, backLink, operatorEmail, onSignedOut }: ConsoleShellProps & { onSignedOut: () => Promise<void> }) {
  const { t, language } = useLanguage();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const { data: newInquiries, isError: inquiryCountFailed } = useQuery({
    queryKey: inquiryCountKey,
    queryFn: ({ signal }) => countNewInquiries(signal),
    retry: false,
  });
  const cache = queryClient.getQueryCache();
  const subscribe = useCallback((listener: () => void) => cache.subscribe(notifyManager.batchCalls(listener)), [cache]);
  const latestPageUpdate = () => cache.findAll({
    queryKey: operatorQueryScope,
    type: 'active',
    predicate: ({ queryKey }) => queryKey[1] !== 'local-session'
      && !(queryKey[1] === 'inquiries' && queryKey[2] === 'new-count'),
  }).reduce((latest, { state }) => Math.max(latest, state.dataUpdatedAt), 0);
  const updatedAt = useSyncExternalStore(subscribe, latestPageUpdate, () => 0);

  const [narrow, setNarrow] = useState(() => window.matchMedia?.(drawerMedia).matches ?? false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const menu = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const restoreMenuFocus = useRef(false);
  const railId = useId();

  useEffect(() => {
    const media = window.matchMedia?.(drawerMedia);
    function onChange(event: MediaQueryListEvent) {
      setNarrow(event.matches);
      if (!event.matches) setDrawerOpen(false);
    }
    media?.addEventListener('change', onChange);
    return () => media?.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (drawerOpen) {
      closeButton.current?.focus();
      restoreMenuFocus.current = true;
    } else if (restoreMenuFocus.current) {
      if (narrow) menu.current?.focus();
      restoreMenuFocus.current = false;
    }
  }, [drawerOpen, narrow]);

  function closeDrawer() {
    setDrawerOpen(false);
  }

  function handleDrawerKey(event: KeyboardEvent<HTMLElement>) {
    if (!drawerOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDrawer();
    }
    if (event.key === 'Tab') {
      const targets = event.currentTarget.querySelectorAll<HTMLElement>(':is(a[href], button:not(:disabled))');
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await queryClient.refetchQueries({
        queryKey: operatorQueryScope,
        type: 'active',
        predicate: ({ queryKey }) => queryKey[1] !== 'local-session',
      });
    } finally {
      setRefreshing(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    setSignOutFailed(false);
    try {
      await signOutLocalOperator();
    } catch {
      setSignOutFailed(true);
      setSigningOut(false);
      return;
    }
    await onSignedOut();
  }

  const section = links.find(({ to }) => pathname === to || (to !== '/platform' && pathname.startsWith(`${to}/`)));
  const pageTitle = title ?? section?.label ?? 'Overview';
  const time = updatedAt ? new Intl.DateTimeFormat(language, { timeStyle: 'short', timeZone: 'Asia/Karachi' }).format(updatedAt) : null;

  return (
    <div className="workspace px-console px-shell">
      <aside
        className="px-shell-rail"
        id={railId}
        role={narrow ? 'dialog' : undefined}
        aria-label={narrow ? t('Platform console') : undefined}
        aria-modal={drawerOpen || undefined}
        inert={narrow && !drawerOpen}
        onKeyDown={handleDrawerKey}
      >
        <div className="px-shell-brand">
          <div className="px-shell-brand-identity">
            <BrandLogo />
            <span className="px-shell-brand-caption">{t('Platform console')}</span>
          </div>
          <button ref={closeButton} className="px-shell-icon px-shell-drawer-control" type="button" aria-label={t('Close menu')} onClick={closeDrawer}>
            <X aria-hidden="true" />
          </button>
        </div>
        <nav aria-label={t('Main navigation')} className="px-shell-nav">
          {links.map(({ to, label, icon: Icon }) => {
            const count = label === 'Inquiries' && !inquiryCountFailed ? newInquiries : undefined;
            return (
              <NavLink key={to} to={to} end={to === '/platform'} onClick={closeDrawer}
                aria-label={count ? t('Inquiries, {count} new', { count }) : undefined}>
                <Icon aria-hidden="true" />
                <span>{t(label)}</span>
                {!!count && <span className="px-shell-count" aria-hidden="true">{count}</span>}
              </NavLink>
            );
          })}
        </nav>
        <div className="px-shell-operator">
          <strong>{t('Platform owner')}</strong>
          {operatorEmail && <bdi>{operatorEmail}</bdi>}
          <button className="px-shell-sign-out" type="button" onClick={() => void signOut()} disabled={signingOut}>
            <LogOut aria-hidden="true" />{t(signingOut ? 'Signing out…' : 'Sign out')}
          </button>
          {signOutFailed && <div role="alert">{t('Sign out failed. Try again.')}</div>}
        </div>
      </aside>
      <div className="px-shell-scrim" data-open={drawerOpen} aria-hidden="true" onClick={closeDrawer} />
      <div className="px-shell-page" inert={drawerOpen}>
        <header className="px-shell-top">
          <button ref={menu} className="px-shell-icon px-shell-drawer-control" type="button" aria-label={t('Open menu')} aria-expanded={drawerOpen} aria-controls={railId} onClick={() => setDrawerOpen(true)}>
            <Menu aria-hidden="true" />
          </button>
          <div className="px-shell-heading">
            {backLink && <Link className="px-shell-back" to={backLink.to}><ArrowLeft aria-hidden="true" />{t(backLink.label)}</Link>}
            <h1>{t(pageTitle)}</h1>
          </div>
          <div className="px-shell-tools">
            <span className="px-shell-updated" role="status">
              {time ? <time dateTime={new Date(updatedAt).toISOString()}>{t('Updated {time}', { time })}</time> : t('Updated: Not available')}
            </span>
            <button className="px-shell-icon" type="button" aria-label={t('Refresh')} onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw aria-hidden="true" />
            </button>
          </div>
        </header>
        <main className="px-shell-content"><Outlet /></main>
      </div>
    </div>
  );
}
