// Her edits on top of the automatic draft. The draft is rebuilt from the data
// every time (so linking a name or uploading cash updates it); the edits are
// kept per row and re-applied. A row she edited counts as reviewed, so its
// flags are cleared, except a missing client.

import type { ApprovalWithBalance, PackageWithBalance } from './api'
import type { DayDraft, DayRow } from './day-builder'
import type { ReportData, ReportRow } from './report'

export type RowEdit = Partial<Pick<DayRow, 'billingType' | 'packageId' | 'approvalId' | 'sessionNo' | 'billed' | 'collected' | 'therapist' | 'extraNote' | 'clientId' | 'clientName'>> & {
  /**
   * She typed the session number of a package / insurance session: on confirm
   * the package or approval is re-anchored so this session is that number and
   * the next one follows from it.
   */
  sessionAnchor?: boolean
}

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
      const { sessionAnchor: _anchor, ...change } = edit
      const next: DayRow = { ...r, ...change }
      if (next.billingType !== 'package') next.packageId = null
      if (next.billingType !== 'insurance') next.approvalId = null
      next.flags = next.clientId ? [] : r.flags.filter((f) => f.kind === 'unmatched')
      return next
    })
  return { rows, excluded: [...excluded, ...all.filter((r) => edits.removed.includes(r.key))] }
}

/**
 * The edits to save with a confirmed day: every row frozen as she confirmed it
 * (so reopening it later shows exactly that, even if later days changed the
 * package counts), re-anchors dropped (they were applied on confirm).
 */
export function frozenEdits(rows: DayRow[], edits: DayEdits): DayEdits {
  const added = new Map(rows.filter((r) => r.key.startsWith('added:')).map((r) => [r.key, r]))
  const frozen: Record<string, RowEdit> = {}
  for (const r of rows) {
    if (added.has(r.key)) continue
    frozen[r.key] = {
      billingType: r.billingType,
      packageId: r.packageId,
      approvalId: r.approvalId,
      sessionNo: r.sessionNo,
      billed: r.billed,
      collected: r.collected,
      therapist: r.therapist,
      extraNote: r.extraNote,
      clientId: r.clientId,
      clientName: r.clientName,
    }
  }
  return { ...edits, rows: frozen, added: edits.added.map((a) => ({ ...(added.get(a.key) ?? a), flags: [] })) }
}

type SavedSession = {
  id: string
  client_id: string | null
  client_name: string | null
  therapist: string | null
  billing_type: string
  package_id: string | null
  approval_id: string | null
  schedule_entry_id: string | null
  session_no: number | null
  billed: number
  collected: number
  extra_note: string | null
}

/**
 * For days confirmed before edits were saved: rebuild the edits from the
 * confirmed sessions, matched to the draft by booking (or by client for
 * payments without a booking); sessions that match nothing come back as
 * added rows, draft rows that weren't confirmed as removed.
 */
export function editsFromSessions(draft: DayDraft, sessions: SavedSession[]): DayEdits {
  const edits = emptyEdits()
  const pool = [...draft.rows, ...draft.excluded]
  const used = new Set<string>()
  const toEdit = (s: SavedSession): RowEdit => ({
    billingType: s.billing_type as DayRow['billingType'],
    packageId: s.package_id,
    approvalId: s.approval_id,
    sessionNo: s.session_no,
    billed: Number(s.billed),
    collected: Number(s.collected),
    therapist: s.therapist,
    extraNote: s.extra_note ?? '',
    clientId: s.client_id,
    clientName: s.client_name ?? '',
  })
  for (const s of sessions) {
    const match =
      pool.find((r) => !used.has(r.key) && s.schedule_entry_id && r.scheduleEntryId === s.schedule_entry_id) ??
      pool.find((r) => !used.has(r.key) && !r.scheduleEntryId && s.client_id && r.clientId === s.client_id)
    if (match) {
      used.add(match.key)
      edits.rows[match.key] = toEdit(s)
      if (draft.excluded.includes(match)) edits.restored.push(match.key)
    } else {
      const e = toEdit(s)
      edits.added.push({
        key: `added:${s.id}`,
        clientId: s.client_id,
        clientName: s.client_name ?? '',
        therapist: s.therapist,
        slotTime: null,
        status: 'walk-in',
        billingType: e.billingType!,
        packageId: s.package_id,
        approvalId: s.approval_id,
        serialNumber: null,
        sessionNo: s.session_no,
        sheetSessionNo: null,
        billed: Number(s.billed),
        collected: Number(s.collected),
        paymentMethod: null,
        extraNote: s.extra_note ?? '',
        scheduleEntryId: s.schedule_entry_id,
        cashIds: [],
        rawName: null,
        flags: [],
      })
    }
  }
  edits.removed = draft.rows.filter((r) => !used.has(r.key)).map((r) => r.key)
  return edits
}

/**
 * A package's payment status for the report: "Paid" (green) or what is still
 * owed, e.g. "$300 due" (red). Null when the amount paid isn't known.
 */
export function packagePaid(p: { amount_paid: number | null; price_total: number } | undefined): { paid: string; paidInFull: boolean } | null {
  if (!p || p.amount_paid === null || p.amount_paid === undefined) return null
  const due = Math.round((Number(p.price_total) - Number(p.amount_paid)) * 100) / 100
  return due <= 0 ? { paid: 'Paid', paidInFull: true } : { paid: `$${due.toLocaleString('en-US')} due`, paidInFull: false }
}

/** The cash statement's balance after a day's last line (the row lowest in the sheet that has one). */
export function closingBalance(rows: Array<{ balance: number | null; source_row: number | null }>): number | null {
  const withBalance = rows.filter((r) => r.balance !== null && r.balance !== undefined)
  if (!withBalance.length) return null
  return Number(withBalance.reduce((a, b) => ((b.source_row ?? 0) > (a.source_row ?? 0) ? b : a)).balance)
}

/** "7/12" for a package or insurance session, else the number on its own. */
export function sessionLabel(sessionNo: number | null, total: number | null | undefined): string | number | null {
  if (sessionNo === null || sessionNo === undefined) return null
  return total ? `${sessionNo}/${total}` : sessionNo
}

/** The report's contents from the reviewed rows. */
export function toReportData(
  rows: DayRow[],
  expenses: Array<{ label: string; amount: number }>,
  otherIncome: Array<{ label: string; amount: number }>,
  packages: PackageWithBalance[],
  dateLabel: string,
  approvals: ApprovalWithBalance[] = [],
): ReportData {
  const totalOf = (r: DayRow) =>
    r.billingType === 'package'
      ? packages.find((p) => p.id === r.packageId)?.sessions_total
      : r.billingType === 'insurance'
        ? approvals.find((a) => a.id === r.approvalId)?.sessions_approved
        : null
  const toRow = (r: DayRow): ReportRow => ({
    client: r.clientName,
    therapist: r.therapist ?? '',
    billed: r.billed,
    collected: r.collected,
    ...(r.billingType === 'package' ? (packagePaid(packages.find((p) => p.id === r.packageId)) ?? {}) : {}),
    sessionNo: sessionLabel(r.sessionNo, totalOf(r)),
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
