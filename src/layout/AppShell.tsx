import { NavLink, Outlet } from 'react-router'
import { useNavCounts } from '../lib/nav-counts'
import { ClientsIcon, MoreIcon, RemindersIcon, ScheduleIcon, TodayIcon } from './icons'

const NAV_ITEMS = [
  { to: '/', label: 'Today', Icon: TodayIcon, end: true, count: 'today' },
  { to: '/schedule', label: 'Schedule', Icon: ScheduleIcon, end: false },
  { to: '/reminders', label: 'Reminders', Icon: RemindersIcon, end: false, count: 'reminders' },
  { to: '/clients', label: 'Clients', Icon: ClientsIcon, end: false },
  { to: '/more', label: 'More', Icon: MoreIcon, end: false },
] as const

/** Bottom navigation on phones, a side rail on wide screens. */
export function AppShell() {
  const counts = useNavCounts()
  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <span className="nav-brand">Clinic Admin</span>
        {NAV_ITEMS.map((item) => {
          const { to, label, Icon, end } = item
          const n = 'count' in item ? counts[item.count] : 0
          return (
            <NavLink key={to} to={to} end={end} className="nav-item">
              <span className="nav-icon-wrap">
                <Icon className="nav-icon" />
                {n > 0 && (
                  <span className="nav-badge" aria-hidden="true">
                    {n > 9 ? '9+' : n}
                  </span>
                )}
              </span>
              <span>
                {label}
                {n > 0 && <span className="visually-hidden">, {n} to do</span>}
              </span>
            </NavLink>
          )
        })}
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
