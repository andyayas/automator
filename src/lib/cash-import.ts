// Plans a cash statement upload against what is already stored. Re-uploading
// the whole file is safe: rows are matched by source_key; changed rows are
// updated and listed; rows missing from the file are flagged, never deleted.
// New "Package of N" receipts become proposed packages for her to review.

import type { CashRow } from './cash-statement'
import type { Tables, TablesInsert } from './database.types'
import type { NameMatch } from './names'

export type StoredCash = Pick<
  Tables<'cash_transactions'>,
  'id' | 'date' | 'source_key' | 'name_raw' | 'description' | 'debit' | 'credit' | 'method' | 'pos_amount' | 'kind' | 'missing_from_source' | 'balance'
>
export type CashInsert = Omit<TablesInsert<'cash_transactions'>, 'owner_id' | 'id' | 'created_at' | 'updated_at'>

export type CashChange = { id: string; row: CashRow; fields: string[]; values: Partial<CashInsert> }
export type PackageProposal = {
  clientId: string
  clientName: string
  sessions: number
  price: number
  date: string
  voucher: string | null
  note: string
}

export type CashImportPlan = {
  inserts: CashInsert[]
  changes: CashChange[]
  unchanged: number
  /** Stored rows no longer in the file (flagged, not deleted). */
  missing: string[]
  /** Rows that were missing before and are back. */
  returned: string[]
  packageProposals: PackageProposal[]
  /** Rows whose running balance changed or wasn't stored yet (saved quietly, not listed as changes). */
  balances: Array<{ id: string; balance: number }>
  /** Package receipts whose payer matches no client. */
  unmatchedPackages: CashRow[]
}

const CLIENT_KINDS = new Set(['session', 'package', 'insurance_copay', 'other'])

/** Money in: debit, or the amount written in the description (POS, transfer). */
const received = (r: CashRow) => r.debit ?? r.descAmount ?? 0

export function toInsert(r: CashRow, clientId: string | null): CashInsert {
  return {
    date: r.date,
    name_raw: r.nameRaw || null,
    description: r.description || null,
    voucher: r.voucher,
    source_key: r.sourceKey,
    debit: r.debit,
    credit: r.credit,
    method: r.method,
    pos_amount: r.descAmount,
    kind: r.kind,
    client_id: clientId,
    source_sheet: r.sheet,
    source_row: r.row,
    missing_from_source: false,
    balance: r.balance,
  }
}

export function planCashImport(
  rows: CashRow[],
  stored: StoredCash[],
  match: (name: string) => NameMatch,
  nameOf: (clientId: string) => string,
  existingPackages: Array<{ client_id: string; purchased_on: string | null; sessions_total: number }>,
  /** Only receipts on or after this date become proposals (older ones are history the seed covered). */
  proposeFrom: string,
): CashImportPlan {
  const plan: CashImportPlan = { inserts: [], changes: [], unchanged: 0, missing: [], returned: [], packageProposals: [], balances: [], unmatchedPackages: [] }
  // Balances are only needed for recent reports: older rows keep what they have.
  const balanceFrom = (() => {
    const d = new Date(`${proposeFrom}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 62)
    return d.toISOString().slice(0, 10)
  })()
  const byKey = new Map(stored.map((s) => [s.source_key, s]))
  const seen = new Set<string>()
  const havePackage = new Set(existingPackages.map((p) => `${p.client_id}|${p.purchased_on}|${p.sessions_total}`))

  for (const r of rows) {
    seen.add(r.sourceKey)
    const m = CLIENT_KINDS.has(r.kind) && r.nameRaw ? match(r.nameRaw) : ({ kind: 'none' } as NameMatch)
    const clientId = m.kind === 'none' || (m.kind === 'fuzzy' && m.ambiguousWith) ? null : m.id
    const values = toInsert(r, clientId)
    const old = byKey.get(r.sourceKey)

    if (!old) {
      plan.inserts.push(values)
      if (r.kind === 'package' && r.packageSessions && r.date >= proposeFrom) {
        if (!clientId) plan.unmatchedPackages.push(r)
        else if (!havePackage.has(`${clientId}|${r.date}|${r.packageSessions}`)) {
          plan.packageProposals.push({
            clientId,
            clientName: nameOf(clientId),
            sessions: r.packageSessions,
            price: received(r),
            date: r.date,
            voucher: r.voucher,
            note: `Detected from the cash statement: "${r.description}"${r.voucher ? ` (${r.voucher})` : ''} on ${r.date}${m.kind === 'fuzzy' ? `; paid as "${r.nameRaw}", check it's the right client` : ''}.`,
          })
        }
      }
      continue
    }

    const fields: string[] = []
    if ((old.name_raw ?? '') !== (values.name_raw ?? '')) fields.push('name')
    if ((old.description ?? '') !== (values.description ?? '')) fields.push('description')
    if (Number(old.debit ?? 0) !== Number(values.debit ?? 0)) fields.push('debit')
    if (Number(old.credit ?? 0) !== Number(values.credit ?? 0)) fields.push('credit')
    if (Number(old.pos_amount ?? 0) !== Number(values.pos_amount ?? 0)) fields.push('POS amount')
    if (old.method !== values.method) fields.push('method')
    if (r.balance !== null && r.date >= balanceFrom && (old.balance === null || Number(old.balance) !== r.balance)) {
      if (fields.length) values.balance = r.balance
      else plan.balances.push({ id: old.id, balance: r.balance })
    }
    if (fields.length) plan.changes.push({ id: old.id, row: r, fields, values })
    else if (old.missing_from_source) plan.returned.push(old.id)
    else plan.unchanged++
  }

  for (const s of stored) if (!seen.has(s.source_key) && !s.missing_from_source) plan.missing.push(s.id)
  return plan
}

/**
 * From which date new package receipts are proposed: the day after the newest
 * receipt already stored, or, on the very first upload, the last 14 days.
 */
export function proposalStartDate(storedDates: string[], today: string): string {
  const latest = storedDates.reduce((max, d) => (d > max ? d : max), '')
  if (latest) {
    const next = new Date(`${latest}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    return next.toISOString().slice(0, 10)
  }
  const start = new Date(`${today}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - 14)
  return start.toISOString().slice(0, 10)
}
