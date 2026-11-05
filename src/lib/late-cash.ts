// Cash statement lines that arrived after a day was confirmed. A confirmed day
// keeps what she confirmed, so these would never reach its report: Today and
// the day page point them out, and reopening the day takes them in.

import type { DayRow } from './day-builder'
import type { DayEdits } from './day-edits'

export type LateCashInput = {
  id: string
  date: string
  created_at: string
  missing_from_source: boolean
  kind: string
  name_raw: string | null
  description: string | null
  debit: number | null
  credit: number | null
  pos_amount: number | null
}

const sameLine = (a: LateCashInput, b: LateCashInput) =>
  a.date === b.date &&
  (a.name_raw ?? '') === (b.name_raw ?? '') &&
  (a.description ?? '') === (b.description ?? '') &&
  Number(a.debit ?? 0) === Number(b.debit ?? 0) &&
  Number(a.credit ?? 0) === Number(b.credit ?? 0) &&
  Number(a.pos_amount ?? 0) === Number(b.pos_amount ?? 0)

/**
 * Per confirmed day, the lines added after she confirmed it. Bank transfers
 * don't count, nor a line that only came back under a new key (its old copy,
 * now missing from the file, was there when she confirmed).
 */
export function lateCash(
  reviews: Array<{ date: string; confirmed_at: string | null }>,
  cash: LateCashInput[],
): Array<{ date: string; lines: LateCashInput[] }> {
  const out: Array<{ date: string; lines: LateCashInput[] }> = []
  for (const r of [...reviews].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!r.confirmed_at) continue
    const confirmedAt = Date.parse(r.confirmed_at)
    const day = cash.filter((c) => c.date === r.date)
    const lines = day.filter(
      (c) =>
        !c.missing_from_source &&
        c.kind !== 'transfer' &&
        Date.parse(c.created_at) > confirmedAt &&
        !day.some((o) => o.missing_from_source && Date.parse(o.created_at) <= confirmedAt && sameLine(o, c)),
    )
    if (lines.length) out.push({ date: r.date, lines })
  }
  return out
}

/**
 * Reopening a day with late lines: a row that got new money takes its amount
 * from the cash statement instead of the one she confirmed. Everything else
 * stays as confirmed.
 */
export function takeLateCash(edits: DayEdits, rows: DayRow[], lateIds: Set<string>): DayEdits {
  const next = { ...edits, rows: { ...edits.rows } }
  for (const r of rows) {
    const edit = next.rows[r.key]
    if (!edit || !r.cashIds.some((id) => lateIds.has(id))) continue
    const { collected: _confirmed, ...rest } = edit
    next.rows[r.key] = rest
  }
  return next
}
