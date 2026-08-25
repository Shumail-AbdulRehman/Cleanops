/* eslint-disable react-refresh/only-export-components -- The router imports the route table from this module. */
import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation, useParams, type RouteObject } from 'react-router-dom';
import { useLanguage } from '@/i18n/context';
import OperatorLogin, { OperatorBoundary, OperatorCallback, OperatorSecurity } from './OperatorLogin';
import { getLocalOperatorSession, localSessionKey } from './operatorSession';

const ConsoleShell = lazy(() => import('./console/shell/ConsoleShell'));
const OverviewPage = lazy(() => import('./console/overview/OverviewPage'));
const CompaniesListPage = lazy(() => import('./console/companies/CompaniesListPage'));
const CompanyDetailLayout = lazy(() => import('./console/company/CompanyDetailPage').then(module => ({ default: module.CompanyDetailLayout })));
const CompanyDetailPage = lazy(() => import('./console/company/CompanyDetailPage'));
const SubscriptionsView = lazy(() => import('./console/billing/SubscriptionsView').then(module => ({ default: module.SubscriptionsView })));
const PaymentsView = lazy(() => import('./console/billing/PaymentsView').then(module => ({ default: module.PaymentsView })));
const InquiriesPage = lazy(() => import('./console/inquiries/InquiriesPage'));

function ConsoleOutlet() {
  const { t } = useLanguage();
  return <Suspense fallback={<p role="status">{t('Loading…')}</p>}><Outlet /></Suspense>;
}

function ConsoleLayout({ companyDetail = false }: { companyDetail?: boolean }) {
  // The operator boundary owns session requests. This observer only reads its cached result.
  const { data: session } = useQuery({ queryKey: localSessionKey, queryFn: getLocalOperatorSession, enabled: false });
  const Layout = companyDetail ? CompanyDetailLayout : ConsoleShell;
  return <Layout operatorEmail={session?.authenticated ? session.email : undefined} />;
}

function InquiryBookmark() {
  const { inquiryId } = useParams();
  const { search, hash } = useLocation();
  const params = new URLSearchParams(search);
  if (inquiryId) params.set('inquiry', inquiryId);
  return <Navigate to={{ pathname: '/platform/inquiries', search: params.toString(), hash }} replace />;
}

/** Mount outside App/GuestRoute/ProtectedRoute and their tenant session bootstrap. */
export const platformRoutes: RouteObject[] = [
  {
    path: '/platform',
    children: [
      { path: 'login', element: <OperatorLogin /> },
      { path: 'callback', element: <OperatorCallback /> },
      { path: 'security', element: <OperatorSecurity /> },
      { path: 'service', element: <Navigate to="/platform/overview" replace /> },
      { path: 'audit', element: <Navigate to="/platform/overview" replace /> },
      { path: 'inquiries/:inquiryId', element: <InquiryBookmark /> },
      {
        element: <OperatorBoundary><ConsoleOutlet /></OperatorBoundary>,
        children: [
          {
            element: <ConsoleLayout />,
            children: [{
              element: <ConsoleOutlet />,
              children: [
                { index: true, element: <OverviewPage /> },
                { path: 'overview', element: <OverviewPage /> },
                { path: 'companies', element: <CompaniesListPage /> },
                { path: 'subscriptions', element: <SubscriptionsView /> },
                { path: 'subscriptions/payments', element: <PaymentsView /> },
                { path: 'inquiries', element: <InquiriesPage /> },
              ],
            }],
          },
          {
            path: 'companies/:id',
            element: <ConsoleLayout companyDetail />,
            children: [{ index: true, element: <CompanyDetailPage /> }],
          },
        ],
      },
      { path: '*', element: <OperatorLogin /> },
    ],
  },
];
