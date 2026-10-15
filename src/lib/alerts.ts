import type { ApprovalWithBalance, PackageWithBalance } from './api'
import { daysBetween, formatDate, plural } from './format'

export const EXPIRY_WARNING_DAYS = 7
export const LOW_SESSIONS = 1

export type BalanceAlert = {
  kind: 'no-sessions' | 'last-session' | 'expired' | 'expiring'
  item: { type: 'package'; value: PackageWithBalance } | { type: 'approval'; value: ApprovalWithBalance }
  message: string
}

/** Alerts for active packages and approvals: ≤ 1 session left, approvals expiring or expired. */
export function balanceAlerts(
  packages: PackageWithBalance[],
  approvals: ApprovalWithBalance[],
  today: string,
): BalanceAlert[] {
  const alerts: BalanceAlert[] = []
  const sessionAlert = (remaining: number) =>
    remaining <= 0
      ? ({ kind: 'no-sessions', message: remaining < 0 ? `${plural(-remaining, 'session')} over` : 'No sessions left' } as const)
      : remaining <= LOW_SESSIONS
        ? ({ kind: 'last-session', message: 'Last session left' } as const)
        : null

  for (const p of packages) {
    if (p.status !== 'active') continue
    const a = sessionAlert(p.sessions_remaining)
    if (a) alerts.push({ ...a, item: { type: 'package', value: p } })
  }
  for (const ap of approvals) {
    if (ap.status !== 'active') continue
    const a = sessionAlert(ap.sessions_remaining)
    if (a) alerts.push({ ...a, item: { type: 'approval', value: ap } })
    if (ap.valid_until) {
      const days = daysBetween(today, ap.valid_until)
      if (days < 0) alerts.push({ kind: 'expired', message: `Expired ${formatDate(ap.valid_until, { short: true })}`, item: { type: 'approval', value: ap } })
      else if (days <= EXPIRY_WARNING_DAYS)
        alerts.push({
          kind: 'expiring',
          message: days === 0 ? 'Expires today' : `Expires in ${plural(days, 'day')}`,
          item: { type: 'approval', value: ap },
        })
    }
  }
  const order = { 'no-sessions': 0, expired: 1, 'last-session': 2, expiring: 3 }
  return alerts.sort((x, y) => order[x.kind] - order[y.kind])
}
