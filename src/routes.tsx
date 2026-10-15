import { Navigate, type RouteObject } from 'react-router'
import { RequireAuth } from './auth/RequireAuth'
import { AppShell } from './layout/AppShell'
import { LoginPage } from './pages/LoginPage'
import { MorePage } from './pages/MorePage'
import { ClientsPage, RemindersPage, SchedulePage, TodayPage } from './pages/placeholders'

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
      { path: 'clients', element: <ClientsPage /> },
      { path: 'reminders', element: <RemindersPage /> },
      { path: 'more', element: <MorePage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]
