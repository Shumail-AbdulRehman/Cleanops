import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from '@/components/common/BrandLogo';
import LanguageChoice from '@/components/common/LanguageChoice';
import { PublicNavbar } from '@/components/layout/PublicNavbar';
import { useLanguage } from '@/i18n/context';
import './flow.css';

const steps = [
  { id: 'account', label: 'Account' },
  { id: 'plan', label: 'Plan' },
  { id: 'payment', label: 'Card' },
  { id: 'workspace', label: 'Workspace' },
] as const;

export type FlowStep = 'none' | (typeof steps)[number]['id'] | 'done';
export type FlowShellProps = {
  size?: 'narrow' | 'split' | 'plan' | 'wide';
  step?: FlowStep;
  /** The caller validates test mode; the shell never infers provider state. */
  testMode?: boolean;
  children: ReactNode;
  /** Screen-owned worksheet content, shown only in a desktop split sheet. */
  aside?: ReactNode;
  /** Replaces the logo header with the public site navbar. */
  siteNav?: boolean;
};

/** A checkbox whose tick draws itself while something loads. */
export function FlowWaitTick() {
  return (
    <span className="flow-wait-box" aria-hidden="true">
      <svg viewBox="0 0 20 20" focusable="false"><path d="m4 10 4 4 8-9" pathLength="1" /></svg>
    </span>
  );
}

/** One loading line with a tick that draws itself. */
export function FlowWait({ label, heading = false }: { label: string; heading?: boolean }) {
  const Text = heading ? 'h1' : 'p';
  return (
    <div className={heading ? 'flow-wait flow-wait-page' : 'flow-wait'} role="status">
      <FlowWaitTick />
      <Text>{label}</Text>
    </div>
  );
}

/** Presentation only. Step completion never grants billing or workspace access. */
export default function FlowShell({ size = 'narrow', step = 'none', testMode = false, children, aside, siteNav = false }: FlowShellProps) {
  const { language, t } = useLanguage();
  const contentId = useId();
  const sheetRef = useRef<HTMLElement>(null);
  const completed = step === 'done' ? steps.length : Math.max(0, steps.findIndex((item) => item.id === step));
  // The workspace is the fourth sheet itself: the approved ready view keeps three edges.
  const depth = Math.min(completed, steps.length - 1);

  useEffect(() => {
    const sheet = sheetRef.current;
    const target = sheet?.querySelector<HTMLElement>('h1') ?? sheet;
    if (!target) return;
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }, [step]);

  return (
    <div className="flow-shell" dir={language === 'ur' ? 'rtl' : 'ltr'} lang={language === 'ur' ? 'ur-PK' : 'en-PK'}>
      <a className="flow-skip" href={`#${contentId}`}>{t('Skip to content')}</a>
      <svg className="flow-supergraphic" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <path d="M10 55 36 81 92 14" />
      </svg>
      {siteNav ? <PublicNavbar languageChoice={<LanguageChoice />} /> : (
        <header className="flow-header">
          <Link to="/login" className="flow-brand" aria-label={t('Hygene Ops sign in')}><BrandLogo /></Link>
          <div className="flow-header-actions">
            {testMode && <span className="flow-chip flow-chip-warn">{t('Test mode')}</span>}
            <LanguageChoice />
          </div>
        </header>
      )}
      <div className="flow-stage" data-size={size}>
        <div className="flow-stack" aria-hidden="true" data-depth={depth}>
          {[1, 2, 3].map((edge) => <span key={edge} className="flow-edge" data-visible={edge <= depth ? 'true' : 'false'} />)}
        </div>
        <main className="flow-sheet" data-size={size} data-step={step} id={contentId} ref={sheetRef} tabIndex={-1}>
          {step !== 'none' && (
            <nav className="flow-steps" aria-label={t('Setup progress')}>
              <ol>
                {steps.map((item, index) => (
                  <li key={item.id} data-complete={index < completed ? 'true' : undefined} aria-current={item.id === step ? 'step' : undefined}>
                    <span className="flow-step-box" aria-hidden="true">
                      <svg viewBox="0 0 20 20" focusable="false"><path d="m4 10 4 4 8-9" pathLength="1" /></svg>
                    </span>
                    <span>{t(item.label)}</span>
                    {index < completed && <span className="flow-sr-only">{t('Step completed')}</span>}
                  </li>
                ))}
              </ol>
            </nav>
          )}
          <div className="flow-body">
            <div className="flow-content">{children}</div>
            {size === 'split' && aside && <aside className="flow-panel">{aside}</aside>}
          </div>
        </main>
      </div>
    </div>
  );
}
