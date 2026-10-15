// Her edits on top of the automatic draft. The draft is rebuilt from the data
// every time (so linking a name or uploading cash updates it); the edits are
// kept per row and re-applied. A row she edited counts as reviewed, so its
// flags are cleared, except a missing client.

import type { ApprovalWithBalance, PackageWithBalance } from './api'
import type { DayDraft, DayRow } from './day-builder'
import type { ReportData, ReportRow } from './report'

export type RowEdit = Partial<Pick<DayRow, 'billingType' | 'packageId' | 'approvalId' | 'sessionNo' | 'billed' | 'collected' | 'therapist' | 'extraNote' | 'clientId' | 'clientName'>>

export type DayEdits = {
  rows: Record<string, RowEdit>
  /** Rows she took out of the day. */
  removed: string[]
  /** Cancelled / rescheduled bookings she put back. */
  restored: string[]
  /** Rows she added by hand. */
  added: DayRow[]
  /** Expense and other-income label corrections, by cash row id. */
  labels: Record<string, string>
  /** Cash rows she moved to "other income", or back to a client session. */
  asIncome: string[]
  asSession: string[]
}

export const emptyEdits = (): DayEdits => ({ rows: {}, removed: [], restored: [], added: [], labels: {}, asIncome: [], asSession: [] })

export function applyEdits(draft: DayDraft, edits: DayEdits): { rows: DayRow[]; excluded: DayRow[] } {
  const restored = draft.excluded.filter((r) => edits.restored.includes(r.key)).map((r) => ({ ...r, status: 'confirmed' as const }))
  const excluded = draft.excluded.filter((r) => !edits.restored.includes(r.key))
  const all = [...draft.rows, ...restored, ...edits.added]
  const rows = all
    .filter((r) => !edits.removed.includes(r.key))
    .map((r) => {
      const edit = edits.rows[r.key]
      if (!edit) return r
      const next: DayRow = { ...r, ...edit }
      if (next.billingType !== 'package') next.packageId = null
      if (next.billingType !== 'insurance') next.approvalId = null
      next.flags = next.clientId ? [] : r.flags.filter((f) => f.kind === 'unmatched')
      return next
    })
  return { rows, excluded: [...excluded, ...all.filter((r) => edits.removed.includes(r.key))] }
}

/** The report's contents from the reviewed rows. */
export function toReportData(
  rows: DayRow[],
  expenses: Array<{ label: string; amount: number }>,
  otherIncome: Array<{ label: string; amount: number }>,
  packages: PackageWithBalance[],
  dateLabel: string,
  _approvals: ApprovalWithBalance[] = [],
): ReportData {
  const toRow = (r: DayRow): ReportRow => ({
    client: r.clientName,
    therapist: r.therapist ?? '',
    billed: r.billed,
    collected: r.collected,
    sessionNo: r.sessionNo,
    serialNumber: r.serialNumber,
    note: r.extraNote,
  })
  const byTime = (a: DayRow, b: DayRow) => (a.slotTime ?? '99').localeCompare(b.slotTime ?? '99')
  const section = (t: DayRow['billingType']) => rows.filter((r) => r.billingType === t).sort(byTime).map(toRow)
  const unpaid = new Set(
    packages.filter((p) => p.amount_paid !== null && Number(p.amount_paid) < Number(p.price_total)).map((p) => p.id),
  )
  return {
    dateLabel,
    sections: { insurance: section('insurance'), package: section('package'), per_session: section('per_session'), free: section('free') },
    expenses,
    otherIncome,
    totalClients: new Set(rows.map((r) => r.clientId ?? `name:${r.clientName.toLowerCase()}`)).size,
    packageNotPaid: rows.filter((r) => r.billingType === 'package' && r.packageId && unpaid.has(r.packageId)).length,
  }
}
