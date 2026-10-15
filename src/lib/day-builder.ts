// Builds a day's draft from the schedule, the cash statement and the packages /
// approvals. Nothing here is saved or deducted: she reviews the draft and
// confirms it (CLAUDE.md "Propose, then confirm").

import type { ApprovalWithBalance, PackageWithBalance } from './api'
import { displayName, normalizeName } from './names'

export type BillingType = 'insurance' | 'package' | 'per_session' | 'free'
export type FlagKind =
  | 'unmatched'
  | 'uncertain-name'
  | 'paid-not-scheduled'
  | 'no-status'
  | 'exhausted'
  | 'expired'
  | 'session-mismatch'
  | 'not-paid'
  | 'no-approval'
  | 'no-package'
  | 'package-to-review'
export type DayFlag = { kind: FlagKind; text: string }

export type DayRow = {
  key: string
  clientId: string | null
  clientName: string
  therapist: string | null
  slotTime: string | null
  status: 'confirmed' | 'cancelled' | 'rescheduled' | 'unknown' | 'walk-in'
  billingType: BillingType
  packageId: string | null
  approvalId: string | null
  serialNumber: string | null
  sessionNo: number | null
  sheetSessionNo: number | null
  billed: number
  collected: number
  paymentMethod: 'cash' | 'pos' | 'transfer' | null
  extraNote: string
  scheduleEntryId: string | null
  cashIds: string[]
  /** Name as written on the sheet / in the cash statement, for linking. */
  rawName: string | null
  flags: DayFlag[]
}

export type ExpenseLine = { cashId: string; label: string; amount: number; matchKey: string }
export type InsurerPayment = { cashId: string; name: string; amount: number }

export type DayDraft = {
  date: string
  rows: DayRow[]
  /** Cancelled (X) and rescheduled (R) bookings: not counted, shown for reference. */
  excluded: DayRow[]
  expenses: ExpenseLine[]
  insurerPayments: InsurerPayment[]
}

export type EntryInput = {
  id: string
  slot_time: string
  therapist: string
  parsed_name: string | null
  raw_text: string
  status: string
  session_no: number | null
  billing_note: string | null
  is_non_client: boolean
  client_id: string | null
  match_kind: string | null
}

export type CashInput = {
  id: string
  name_raw: string | null
  description: string | null
  debit: number | null
  credit: number | null
  method: string
  pos_amount: number | null
  kind: string
  client_id: string | null
}

export type DayInputs = {
  date: string
  entries: EntryInput[]
  cash: CashInput[]
  packages: PackageWithBalance[]
  approvals: ApprovalWithBalance[]
  clientNames: Map<string, string>
  expenseLabels: Map<string, string>
  defaults: { perSessionPrice: number; insuranceBilled: number }
}

const CLIENT_CASH = new Set(['session', 'package', 'insurance_copay', 'other'])
const received = (c: CashInput) => Number(c.debit ?? c.pos_amount ?? 0)

export const expenseKey = (name: string | null, description: string | null) =>
  `${(name ?? '').toLowerCase().trim()}|${(description ?? '').toLowerCase().trim()}`

export function buildDayDraft(input: DayInputs): DayDraft {
  const { date, defaults } = input
  const nameOf = (id: string | null, fallback: string | null) =>
    (id && input.clientNames.get(id)) || displayName(fallback ?? '') || 'Unknown'

  // Cash per client (and per unknown payer name).
  const clientCash = new Map<string, CashInput[]>()
  const unknownCash = new Map<string, CashInput[]>()
  const expenses: ExpenseLine[] = []
  const insurerPayments: InsurerPayment[] = []
  for (const c of input.cash) {
    if (c.kind === 'expense') {
      const matchKey = expenseKey(c.name_raw, c.description)
      expenses.push({
        cashId: c.id,
        matchKey,
        label: input.expenseLabels.get(matchKey) ?? displayName(c.description || c.name_raw || 'Expense'),
        amount: Number(c.credit ?? c.pos_amount ?? 0),
      })
    } else if (c.kind === 'insurer_payment') {
      insurerPayments.push({ cashId: c.id, name: displayName(c.name_raw ?? ''), amount: received(c) })
    } else if (CLIENT_CASH.has(c.kind)) {
      if (c.client_id) clientCash.set(c.client_id, [...(clientCash.get(c.client_id) ?? []), c])
      else {
        const key = normalizeName(c.name_raw) || c.id
        unknownCash.set(key, [...(unknownCash.get(key) ?? []), c])
      }
    }
  }

  const activePackages = (id: string) =>
    input.packages
      .filter((p) => p.client_id === id && p.status === 'active')
      .sort((a, b) => (a.purchased_on ?? '').localeCompare(b.purchased_on ?? ''))
  const activeApprovals = (id: string) => input.approvals.filter((a) => a.client_id === id && a.status === 'active')
  const proposedPackage = (id: string) => input.packages.some((p) => p.client_id === id && p.status === 'proposed')

  // Sessions taken today per package / approval, so two sessions get n+1, n+2.
  const usedToday = new Map<string, number>()
  const cashUsed = new Set<string>()

  function bill(row: DayRow, billingNote: string | null) {
    const id = row.clientId
    const cash = id ? (clientCash.get(id) ?? []).filter((c) => !cashUsed.has(c.id)) : []
    const pkgs = id ? activePackages(id) : []
    const apps = id ? activeApprovals(id) : []
    const kinds = new Set(cash.map((c) => c.kind))

    row.billingType =
      billingNote === 'free'
        ? 'free'
        : billingNote === 'insurance' || kinds.has('insurance_copay')
          ? 'insurance'
          : billingNote === 'package' || kinds.has('package')
            ? 'package'
            : kinds.has('session')
              ? 'per_session'
              : apps.length
                ? 'insurance'
                : pkgs.length
                  ? 'package'
                  : 'per_session'

    row.collected = cash.reduce((sum, c) => sum + received(c), 0)
    row.cashIds = cash.map((c) => c.id)
    for (const c of cash) cashUsed.add(c.id)
    const methods = new Set(cash.map((c) => c.method))
    row.paymentMethod = methods.has('pos') ? 'pos' : methods.has('transfer') ? 'transfer' : cash.length ? 'cash' : null

    if (row.billingType === 'insurance') {
      const ap = apps.find((a) => a.sessions_remaining - (usedToday.get(a.id) ?? 0) > 0) ?? apps[0]
      if (!ap) {
        row.billed = defaults.insuranceBilled
        row.flags.push({ kind: 'no-approval', text: 'Insurance, but no active approval' })
        return
      }
      const n = usedToday.get(ap.id) ?? 0
      usedToday.set(ap.id, n + 1)
      row.approvalId = ap.id
      row.serialNumber = ap.serial_number
      row.billed = Number(ap.billed_per_session ?? defaults.insuranceBilled)
      row.sessionNo = ap.sessions_used + n + 1
      if (ap.sessions_remaining - n <= 0) row.flags.push({ kind: 'exhausted', text: 'Approval has no sessions left' })
      if (ap.valid_until && ap.valid_until < date) row.flags.push({ kind: 'expired', text: `Approval expired ${ap.valid_until}` })
    } else if (row.billingType === 'package') {
      const pk = pkgs.find((p) => p.sessions_remaining - (usedToday.get(p.id) ?? 0) > 0) ?? pkgs.at(-1)
      if (!pk) {
        row.billed = 0
        row.flags.push(
          id && proposedPackage(id)
            ? { kind: 'package-to-review', text: 'Package waiting for review on Today; accept it first' }
            : { kind: 'no-package', text: 'Package, but no active package' },
        )
        return
      }
      const n = usedToday.get(pk.id) ?? 0
      usedToday.set(pk.id, n + 1)
      row.packageId = pk.id
      row.billed = Number(pk.per_session)
      row.sessionNo = pk.sessions_used + n + 1
      if (pk.sessions_remaining - n <= 0) row.flags.push({ kind: 'exhausted', text: 'Package has no sessions left' })
    } else if (row.billingType === 'per_session') {
      row.billed = row.collected > 0 ? row.collected : defaults.perSessionPrice
      if (row.collected <= 0) row.flags.push({ kind: 'not-paid', text: 'Came, but no payment in the cash statement' })
    } else {
      row.billed = 0
    }
  }

  const blank = (key: string): DayRow => ({
    key,
    clientId: null,
    clientName: '',
    therapist: null,
    slotTime: null,
    status: 'unknown',
    billingType: 'per_session',
    packageId: null,
    approvalId: null,
    serialNumber: null,
    sessionNo: null,
    sheetSessionNo: null,
    billed: 0,
    collected: 0,
    paymentMethod: null,
    extraNote: '',
    scheduleEntryId: null,
    cashIds: [],
    rawName: null,
    flags: [],
  })

  const rows: DayRow[] = []
  const excluded: DayRow[] = []
  const excludedNotes: Array<string | null> = []
  const bookings = input.entries.filter((e) => !e.is_non_client).sort((a, b) => a.slot_time.localeCompare(b.slot_time))

  for (const e of bookings) {
    const linked = e.match_kind !== 'none' ? e.client_id : null
    const row: DayRow = {
      ...blank(`entry:${e.id}`),
      clientId: linked,
      clientName: nameOf(linked, e.parsed_name ?? e.raw_text),
      therapist: e.therapist,
      slotTime: e.slot_time.slice(0, 5),
      status: (['confirmed', 'cancelled', 'rescheduled'].includes(e.status) ? e.status : 'unknown') as DayRow['status'],
      sheetSessionNo: e.session_no,
      scheduleEntryId: e.id,
      rawName: e.parsed_name,
    }
    if (row.status === 'cancelled' || row.status === 'rescheduled') {
      excluded.push(row)
      excludedNotes.push(e.billing_note)
      continue
    }
    if (!linked) row.flags.push({ kind: 'unmatched', text: 'Name not linked to a client' })
    else if (e.match_kind === 'fuzzy') row.flags.push({ kind: 'uncertain-name', text: `Sheet says “${e.parsed_name}”: check it’s this client` })
    if (row.status === 'unknown') row.flags.push({ kind: 'no-status', text: 'No C/X/R on the sheet: did they come?' })
    bill(row, e.billing_note)
    if (row.sheetSessionNo && row.sessionNo && row.sheetSessionNo !== row.sessionNo) {
      row.flags.push({ kind: 'session-mismatch', text: `Sheet says session ${row.sheetSessionNo}, app counts ${row.sessionNo}` })
    }
    rows.push(row)
  }

  // Paid today but not on the schedule.
  for (const [clientId, cash] of clientCash) {
    if (cash.every((c) => cashUsed.has(c.id))) continue
    const row: DayRow = {
      ...blank(`cash:${clientId}`),
      clientId,
      clientName: nameOf(clientId, cash[0].name_raw),
      status: 'walk-in',
      rawName: cash[0].name_raw,
    }
    row.flags.push({ kind: 'paid-not-scheduled', text: 'Paid today but not on the schedule' })
    bill(row, null)
    rows.push(row)
  }
  for (const [key, cash] of unknownCash) {
    const row: DayRow = {
      ...blank(`cash:?${key}`),
      clientName: displayName(cash[0].name_raw ?? 'Unknown payer'),
      status: 'walk-in',
      rawName: cash[0].name_raw,
      collected: cash.reduce((s, c) => s + received(c), 0),
      cashIds: cash.map((c) => c.id),
    }
    const kinds = new Set(cash.map((c) => c.kind))
    row.billingType = kinds.has('insurance_copay') ? 'insurance' : kinds.has('package') ? 'package' : 'per_session'
    row.billed = row.billingType === 'per_session' ? row.collected : 0
    row.flags.push({ kind: 'paid-not-scheduled', text: 'Paid today but not on the schedule' })
    row.flags.push({ kind: 'unmatched', text: 'Payer not linked to a client' })
    rows.push(row)
  }

  // Billed last, so a cancelled client who still paid shows up as a payment
  // above, and a booking she puts back already has its billing worked out.
  excluded.forEach((row, i) => bill(row, excludedNotes[i]))

  return { date, rows, excluded, expenses, insurerPayments }
}

/** Rows that still need her attention before confirming. */
export const needsAttention = (rows: DayRow[]) => rows.filter((r) => r.flags.length > 0)

export const SECTION_ORDER: BillingType[] = ['insurance', 'package', 'per_session', 'free']
export const SECTION_LABEL: Record<BillingType, string> = {
  insurance: 'Insurance',
  package: 'Package',
  per_session: 'Per Session',
  free: 'Free',
}
