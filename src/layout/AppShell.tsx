import { NavLink, Outlet } from 'react-router'
import { ClientsIcon, MoreIcon, RemindersIcon, ScheduleIcon, TodayIcon } from './icons'

const NAV_ITEMS = [
  { to: '/', label: 'Today', Icon: TodayIcon, end: true },
  { to: '/schedule', label: 'Schedule', Icon: ScheduleIcon, end: false },
  { to: '/clients', label: 'Clients', Icon: ClientsIcon, end: false },
  { to: '/reminders', label: 'Reminders', Icon: RemindersIcon, end: false },
  { to: '/more', label: 'More', Icon: MoreIcon, end: false },
]

/** Bottom navigation on phones, a side rail on wide screens. */
export function AppShell() {
  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <span className="nav-brand">Clinic Admin</span>
        {NAV_ITEMS.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="nav-item">
            <Icon className="nav-icon" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
