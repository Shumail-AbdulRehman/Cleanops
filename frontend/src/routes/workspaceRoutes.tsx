import { SetupPage, ExceptionInboxPage, ExceptionDetailPage, VerificationHistoryPage, AreaSetupPage, AreaDetailPage, LocationsPage, LocationDetailPage, DashboardPage, StaffPage, StaffDetailPage, AttendancePage, TodayStatusPage, ManagersPage } from "./workspacePages";
import { RequireRole } from "../App";
import { CompanySettingsPage } from "../pages/Account/AccountPages";
import type { RouteObject } from "react-router-dom";

export const workspaceRoutes: RouteObject[] = [
          {path:'setup',element:<RequireRole roles={['ADMIN','MANAGER']}><SetupPage/></RequireRole>},
          {path:'exceptions',element:<RequireRole roles={['ADMIN','MANAGER']}><ExceptionInboxPage/></RequireRole>},
          {path:'exceptions/:id',element:<RequireRole roles={['ADMIN','MANAGER']}><ExceptionDetailPage/></RequireRole>},
          {path:'verification/:id',element:<RequireRole roles={['ADMIN','MANAGER']}><VerificationHistoryPage/></RequireRole>},
          { path: 'settings', element: <RequireRole roles={['ADMIN']}><CompanySettingsPage /></RequireRole> },
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'today-status', element: <TodayStatusPage /> },
          { path: 'locations', element: <LocationsPage /> },
          { path: 'locations/:locationId/areas/new', element: <RequireRole roles={['ADMIN', 'MANAGER']}><AreaSetupPage /></RequireRole> },
          { path: 'areas/:id', element: <RequireRole roles={['ADMIN', 'MANAGER']}><AreaDetailPage /></RequireRole> },
          { path: 'locations/:id', element: <LocationDetailPage /> },
          { path: 'staff', element: <StaffPage /> },
          { path: 'staff/:id', element: <StaffDetailPage /> },
          { path: 'attendance', element: <AttendancePage /> },
          {
            path: 'managers',
            element: (
              <RequireRole roles={['ADMIN']}>
                <ManagersPage />
              </RequireRole>
            ),
          },
        ];
