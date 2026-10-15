// What a booking is billed against, and what she should know before the
// session: last session, nothing left, approval expired or expiring.

import type { ApprovalWithBalance, PackageWithBalance } from './api'
import { daysBetween, formatDate } from './format'

export type ContextAlert = { tone: 'warn' | 'danger'; text: string }
export type BookingContext = {
  label: string
  remaining: number | null
  alerts: ContextAlert[]
}

export type ActiveByClient = Map<string, { packages: PackageWithBalance[]; approvals: ApprovalWithBalance[] }>

export function activeByClient(packages: PackageWithBalance[], approvals: ApprovalWithBalance[]): ActiveByClient {
  const map: ActiveByClient = new Map()
  const entry = (id: string) => map.get(id) ?? (map.set(id, { packages: [], approvals: [] }), map.get(id)!)
  for (const p of packages) if (p.status === 'active' && p.client_id) entry(p.client_id).packages.push(p)
  for (const a of approvals) if (a.status === 'active' && a.client_id) entry(a.client_id).approvals.push(a)
  return map
}

export function bookingContext(
  clientId: string | null,
  date: string,
  billingNote: string | null,
  active: ActiveByClient,
): BookingContext | null {
  if (!clientId) return null
  if (billingNote === 'free') return { label: 'Free', remaining: null, alerts: [] }
  const { packages = [], approvals = [] } = active.get(clientId) ?? {}
  const approval = approvals[0]
  const pkg = packages[0]
  const useApproval = approval && (billingNote === 'insurance' || !pkg)

  if (useApproval) {
    const alerts = sessionAlerts(approval.sessions_remaining)
    if (approval.valid_until) {
      const days = daysBetween(date, approval.valid_until)
      if (days < 0) alerts.push({ tone: 'danger', text: `Approval expired ${formatDate(approval.valid_until, { short: true })}` })
      else if (days <= 7) alerts.push({ tone: 'warn', text: `Approval expires ${formatDate(approval.valid_until, { short: true })}` })
    }
    return { label: `Insurance · ${approval.insurer}`, remaining: approval.sessions_remaining, alerts }
  }
  if (pkg) return { label: 'Package', remaining: pkg.sessions_remaining, alerts: sessionAlerts(pkg.sessions_remaining) }
  if (billingNote === 'insurance') {
    return { label: 'Insurance', remaining: null, alerts: [{ tone: 'warn', text: 'No active approval' }] }
  }
  return { label: 'Per session', remaining: null, alerts: [] }
}

function sessionAlerts(remaining: number): ContextAlert[] {
  if (remaining <= 0) return [{ tone: 'danger', text: remaining < 0 ? `${-remaining} over the limit` : 'No sessions left' }]
  if (remaining === 1) return [{ tone: 'warn', text: 'Last session' }]
  return []
}
