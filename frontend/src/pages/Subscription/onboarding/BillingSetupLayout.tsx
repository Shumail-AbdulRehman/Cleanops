import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, LockKeyhole } from 'lucide-react';
import BrandLogo from '@/components/common/BrandLogo';
import LanguageChoice from '@/components/common/LanguageChoice';
import { useLanguage } from '@/i18n/context';
import { serviceInformation } from '@/lib/serviceInformation';
import './billing-setup.css';

type LayoutSlots = {
  children: ReactNode;
  /** Optional screen-owned navigation and footer content. No pathname inference. */
  navigation?: ReactNode;
  footer?: ReactNode;
  /** Omit until the caller has validated the server/browser environment. */
  environment?: 'sandbox' | 'production';
};
export type BillingSetupLayoutProps = LayoutSlots & { variant: 'settings' };

/** Presentation only: callers retain identity, billing readiness and route decisions. */
export default function BillingSetupLayout(props: BillingSetupLayoutProps) {
  const { children, navigation, footer, environment, variant } = props;
  const { language, t } = useLanguage();
  const contentId = useId();
  const { terms, privacy } = serviceInformation(); // Validated public policy URLs; no request.

  return <div className="billing-onboarding" dir={language === 'ur' ? 'rtl' : 'ltr'} lang={language === 'ur' ? 'ur-PK' : 'en-PK'} data-variant={variant}>
    <a className="billing-skip" href={`#${contentId}`}>{t('Skip to content')}</a>
    <aside className="billing-rail">
      <div className="billing-brand"><BrandLogo /></div>
      <div className="billing-rail-body">
        <p className="billing-rail-title">{t('Account settings')}</p>
        <nav className="billing-settings-navigation" aria-label={t('Account settings')}>
          <Link to="/subscription" aria-current="page"><CreditCard aria-hidden="true" />{t('Plan & billing')}</Link>
          <Link to="/account/security"><LockKeyhole aria-hidden="true" />{t('Account security')}</Link>
        </nav>
      </div>
      <div className="billing-rail-bottom"><LockKeyhole aria-hidden="true" />{t(environment === 'sandbox' ? 'Test environment' : 'Secure checkout with Paddle')}</div>
    </aside>
    <div className="billing-main-wrap">
      <header className="billing-topbar">
        <span className="billing-topbar-title">{t('Company workspace')}</span>
        <div className="billing-top-actions">
          {environment === 'sandbox' ? <span className="billing-sandbox">{t('Sandbox · test cards only')}</span> : null}
          <LanguageChoice />
        </div>
      </header>
      <main className="billing-main" id={contentId} tabIndex={-1}>
        {navigation ? <div className="billing-screen-navigation">{navigation}</div> : null}
        {children}
      </main>
      <footer className="billing-footer">
        <div className="billing-footer-message"><LockKeyhole aria-hidden="true" />{footer ?? <span>{t('Card details stay with Paddle.')}</span>}</div>
        {terms || privacy ? <nav aria-label={t('Legal policies')}>
          {terms ? <a href={terms}>{t('Terms')}</a> : null}
          {privacy ? <a href={privacy}>{t('Privacy')}</a> : null}
        </nav> : null}
      </footer>
    </div>
  </div>;
}
