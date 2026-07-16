import './pages/Account/linkToken';
import { OwnSecurityPage, OwnerRecoveryPage, OwnerLinkPage } from './pages/Account/AccountPages';
import { WorkspaceAudience, WorkspaceRouteError } from "./routes/launchPages";
import { platformRoutes } from "./pages/Platform/platformRoutes";
import { workspaceRoutes } from "./routes/workspaceRoutes";
import '@fontsource/noto-sans-arabic/arabic-400.css';
import '@fontsource/noto-sans-arabic/arabic-600.css';
import { LanguageProvider } from './i18n/LanguageProvider';
import { createRoot } from 'react-dom/client';
import './index.css';
import App, { GuestRoute, ProtectedRoute } from './App.tsx';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Provider } from 'react-redux';
import { store } from './store/store.ts';

import DashboardLayout from './components/layout/DashboardLayout.tsx';
import { PublicLayout } from './components/layout/PublicLayout.tsx';
import SignUp from './pages/Signup/SignUpPage.tsx';
import Login from './pages/Login/LoginPage.tsx';
import LandingPage from './pages/Landing/LandingPage.tsx';
import FeaturesPage from './pages/Landing/FeaturesPage.tsx';
import PricingPage from './pages/Pricing/PricingPage.tsx';
import { billingRoutes } from './pages/Subscription/onboarding/billingRoutes';
import WorkspaceGate from './components/onboarding/WorkspaceGate';
import { installModuleLoadRecovery } from './lib/moduleLoadRecovery';

installModuleLoadRecovery();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
    },
  },
});

const router = createBrowserRouter([
  ...platformRoutes,
  {
    path: '/',
    element: <App />,
    errorElement: <WorkspaceRouteError />,
    children: [
      { path: 'account/security', element: <OwnSecurityPage /> },
      { path: 'recover-owner-account', element: <OwnerRecoveryPage /> },
      { path: 'verify-owner-email', element: <OwnerLinkPage kind="verify" /> },
      { path: 'reset-owner-password', element: <OwnerLinkPage kind="reset" /> },
      ...billingRoutes,
      {
        element: <PublicLayout />,
        children: [
          { index: true, element: <LandingPage /> },
          { path: 'features', element: <FeaturesPage /> },
          { path: 'pricing', element: <PricingPage /> },
        ],
      },
      {
        path: 'signup',
        element: (
          <GuestRoute>
            <SignUp />
          </GuestRoute>
        ),
      },
      {
        path: 'login',
        element: (
          <GuestRoute>
            <Login />
          </GuestRoute>
        ),
      },
      {
        element: (
          <ProtectedRoute>
            <WorkspaceGate><WorkspaceAudience><DashboardLayout /></WorkspaceAudience></WorkspaceGate>
          </ProtectedRoute>
        ),
        children: workspaceRoutes,
      },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider><RouterProvider router={router} /></LanguageProvider>
      </QueryClientProvider>
    </Provider>
 
);
