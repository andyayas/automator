// A month's daily reports in one file, rebuilt from the confirmed days (so a
// day she reopened and corrected appears corrected).

import type { ApprovalWithBalance, PackageWithBalance } from './api'
import { expenseKey, OTHER_INCOME } from './day-builder'
import { displayName } from './names'
import type { ReportData, ReportRow } from './report'
import type { Tables } from './database.types'

type Session = Tables<'day_sessions'>
type Expense = Pick<Tables<'cash_transactions'>, 'date' | 'name_raw' | 'description' | 'credit' | 'pos_amount'> &
  Partial<Pick<Tables<'cash_transactions'>, 'kind' | 'debit'>>
type Line = { label: string; amount: number }
type Snapshot = { date: string; expenses: unknown; other_income: unknown }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-10-15" -> "Thu Oct 15", the tab names of her old monthly workbooks. */
export function sheetNameFor(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

export function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

/** Pure: the report contents for each confirmed day. */
export function monthReportDays(input: {
  confirmedDates: string[]
  sessions: Session[]
  expenses: Expense[]
  labels: Map<string, string>
  /** What she confirmed for each day (expense and other-income lines); preferred over recomputing. */
  snapshots?: Snapshot[]
  packages: PackageWithBalance[]
  approvals: ApprovalWithBalance[]
}): Array<{ date: string; sheetName: string; data: ReportData }> {
  const serials = new Map(input.approvals.map((a) => [a.id, a.serial_number]))
  const unpaid = new Set(input.packages.filter((p) => p.amount_paid !== null && Number(p.amount_paid) < Number(p.price_total)).map((p) => p.id))

  return [...input.confirmedDates].sort().map((date) => {
    const sessions = input.sessions.filter((s) => s.date === date)
    const toRow = (s: Session): ReportRow => ({
      client: s.client_name ?? '',
      therapist: s.therapist ?? '',
      billed: Number(s.billed),
      collected: Number(s.collected),
      sessionNo: s.session_no,
      serialNumber: s.approval_id ? (serials.get(s.approval_id) ?? null) : null,
      note: s.extra_note ?? '',
    })
    const section = (t: string) => sessions.filter((s) => s.billing_type === t).map(toRow)
    const snap = input.snapshots?.find((x) => x.date === date)
    const cash = input.expenses.filter((e) => e.date === date)
    const label = (e: Expense, fallback: string) => input.labels.get(expenseKey(e.name_raw, e.description)) ?? fallback
    const expenses: Line[] = Array.isArray(snap?.expenses)
      ? (snap!.expenses as Line[])
      : cash
          .filter((e) => (e.kind ?? 'expense') === 'expense')
          .map((e) => ({ label: label(e, displayName(e.description || e.name_raw || 'Expense')), amount: Number(e.credit ?? e.pos_amount ?? 0) }))
    const otherIncome: Line[] = Array.isArray(snap?.other_income)
      ? (snap!.other_income as Line[])
      : cash
          .filter((e) => e.kind === 'insurer_payment' || (e.kind !== 'expense' && e.kind !== undefined && OTHER_INCOME.test(e.description ?? '')))
          .map((e) => ({
            label: label(e, e.kind === 'insurer_payment' ? `${displayName(e.name_raw ?? '')} payment` : displayName(e.description ?? 'Other income')),
            amount: Number(e.debit ?? e.pos_amount ?? 0),
          }))
    return {
      date,
      sheetName: sheetNameFor(date),
      data: {
        dateLabel: new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
        sections: { insurance: section('insurance'), package: section('package'), per_session: section('per_session'), free: section('free') },
        expenses,
        otherIncome,
        totalClients: new Set(sessions.map((s) => s.client_id ?? `name:${(s.client_name ?? '').toLowerCase()}`)).size,
        packageNotPaid: sessions.filter((s) => s.billing_type === 'package' && s.package_id && unpaid.has(s.package_id)).length,
      },
    }
  })
}
