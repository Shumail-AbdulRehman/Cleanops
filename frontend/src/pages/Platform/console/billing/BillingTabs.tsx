import { NavLink } from 'react-router-dom';
import { useLanguage } from '@/i18n/context';
import '@/components/workspace/table-v6.css';
import './billing.css';

export function BillingTabs() {
  const { t } = useLanguage();

  return (
    <nav className="wx-tabs px-billing-tabs" aria-label={t('Billing')}>
      <NavLink end className="wx-tab" to="/platform/subscriptions">{t('Subscriptions')}</NavLink>
      <NavLink end className="wx-tab" to="/platform/subscriptions/payments">{t('Payments')}</NavLink>
    </nav>
  );
}
