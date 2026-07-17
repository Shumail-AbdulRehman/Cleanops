/** Test-only named-component entry. Never imported by the application router. */
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageProvider';
import { CompanyWorkspace } from '../src/pages/Platform/CompaniesPage';
import { ServiceWorkspace } from '../src/pages/Platform/ServicePage';
import '@fontsource/noto-sans-arabic/arabic-400.css';
import '@fontsource/noto-sans-arabic/arabic-600.css';
import '../src/index.css';

declare global {
  interface Window { __platformVisualFixture?: boolean }
}

// Read exclusively by the runner's in-memory Vite transform; no source adapter
// or public route accepts this flag in the shipped application.
window.__platformVisualFixture = true;
const path = new URLSearchParams(location.search).get('path') ?? '/platform/companies';
const router = createMemoryRouter([
  { path: '/platform/companies', element: <CompanyWorkspace /> },
  { path: '/platform/companies/:companyId', element: <CompanyWorkspace /> },
  { path: '/platform/service', element: <ServiceWorkspace /> },
  { path: '/platform/audit', element: <ServiceWorkspace initialView="audit" /> },
  { path: '/platform/inquiries', element: <ServiceWorkspace initialView="inquiries" /> },
], { initialEntries: [path] });
const query = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={query}><LanguageProvider><RouterProvider router={router} /></LanguageProvider></QueryClientProvider>,
);
