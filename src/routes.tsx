import { Navigate, type RouteObject } from 'react-router'
import { RequireAuth } from './auth/RequireAuth'
import { AppShell } from './layout/AppShell'
import { LoginPage } from './pages/LoginPage'
import { ApprovalFormPage } from './pages/clients/ApprovalFormPage'
import { ClientDetailPage } from './pages/clients/ClientDetailPage'
import { ClientFormPage } from './pages/clients/ClientFormPage'
import { ClientsPage } from './pages/clients/ClientsPage'
import { PackageFormPage } from './pages/clients/PackageFormPage'
import { CashImportPage } from './pages/CashImportPage'
import { ImportContactsPage } from './pages/ImportContactsPage'
import { MorePage } from './pages/MorePage'
import { RemindersPage } from './pages/RemindersPage'
import { ScheduleImportPage } from './pages/ScheduleImportPage'
import { SchedulePage } from './pages/SchedulePage'
import { SettingsPage } from './pages/SettingsPage'
import { TodayPage } from './pages/TodayPage'

// Used with a hash router in the app (GitHub Pages has no SPA fallback)
// and with a memory router in tests.
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <TodayPage /> },
      { path: 'schedule', element: <SchedulePage /> },
      { path: 'schedule/import', element: <ScheduleImportPage /> },
      { path: 'clients', element: <ClientsPage /> },
      { path: 'clients/new', element: <ClientFormPage /> },
      { path: 'clients/:clientId', element: <ClientDetailPage /> },
      { path: 'clients/:clientId/edit', element: <ClientFormPage /> },
      { path: 'clients/:clientId/packages/new', element: <PackageFormPage /> },
      { path: 'clients/:clientId/approvals/new', element: <ApprovalFormPage /> },
      { path: 'packages/:packageId', element: <PackageFormPage /> },
      { path: 'approvals/:approvalId', element: <ApprovalFormPage /> },
      { path: 'reminders', element: <RemindersPage /> },
      { path: 'more', element: <MorePage /> },
      { path: 'more/import-contacts', element: <ImportContactsPage /> },
      { path: 'more/settings', element: <SettingsPage /> },
      { path: 'more/cash', element: <CashImportPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]
