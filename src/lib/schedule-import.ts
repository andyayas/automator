// Turns parsed schedule days into schedule_entries rows, matching each booking
// to a client. Days she has already confirmed are never replaced; their
// differences are reported instead (CLAUDE.md "Import rules").

import type { TablesInsert } from './database.types'
import type { NameMatch } from './names'
import { normalizeName } from './names'
import type { ScheduleDay } from './schedule'

export type EntryInsert = Omit<TablesInsert<'schedule_entries'>, 'owner_id' | 'id' | 'created_at' | 'updated_at'>

export type ScheduleImportPlan = {
  /** Dates whose entries are replaced, with the new rows. */
  replace: Map<string, EntryInsert[]>
  /** Confirmed days left untouched, with how many bookings differ from what is stored. */
  confirmedChanged: Array<{ date: string; differences: number }>
  bookings: number
  matched: number
  uncertain: number
  unmatched: number
  /** Distinct names that matched no client, most frequent first. */
  unmatchedNames: Array<{ name: string; count: number }>
}

export function planScheduleImport(
  days: ScheduleDay[],
  match: (name: string) => NameMatch,
  confirmedDates: Set<string>,
  storedRawByDate: Map<string, string[]>,
): ScheduleImportPlan {
  const plan: ScheduleImportPlan = {
    replace: new Map(),
    confirmedChanged: [],
    bookings: 0,
    matched: 0,
    uncertain: 0,
    unmatched: 0,
    unmatchedNames: [],
  }
  const unknown = new Map<string, { name: string; count: number }>()

  for (const day of days) {
    if (confirmedDates.has(day.date)) {
      const differences = countDifferences(
        storedRawByDate.get(day.date) ?? [],
        day.rows.map((r) => `${r.slotTime}|${r.therapist}|${r.rawText}`),
      )
      if (differences) plan.confirmedChanged.push({ date: day.date, differences })
      continue
    }
    const rows: EntryInsert[] = []
    for (const r of day.rows) {
      const base = {
        date: r.date,
        slot_time: r.slotTime,
        therapist: r.therapist,
        raw_text: r.rawText,
        cell_ref: r.cellRef,
        sheet_tab: r.sheetTab,
      }
      if (r.isNonClient || !r.booking) {
        rows.push({ ...base, is_non_client: true, status: 'unknown' })
        continue
      }
      plan.bookings++
      const b = r.booking
      const m = match(b.name)
      const ambiguous = m.kind === 'fuzzy' && Boolean(m.ambiguousWith)
      const clientId = m.kind === 'none' || ambiguous ? null : m.id
      const matchKind = ambiguous ? 'none' : m.kind
      if (matchKind === 'none') {
        plan.unmatched++
        const key = normalizeName(b.name)
        const u = unknown.get(key) ?? { name: b.name, count: 0 }
        u.count++
        unknown.set(key, u)
      } else if (matchKind === 'fuzzy') plan.uncertain++
      else plan.matched++

      rows.push({
        ...base,
        is_non_client: false,
        parsed_name: b.name,
        name_key: normalizeName(b.name),
        status: b.status,
        session_no: b.sessionNo,
        inline_amount: b.amount,
        billing_note: b.billingNote,
        client_id: clientId,
        match_kind: matchKind,
      })
    }
    plan.replace.set(day.date, rows)
  }
  plan.unmatchedNames = [...unknown.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  return plan
}

/** Bookings present in one list but not the other. */
function countDifferences(before: string[], after: string[]): number {
  const left = new Map<string, number>()
  for (const x of before) left.set(x, (left.get(x) ?? 0) + 1)
  let diff = 0
  for (const x of after) {
    const n = left.get(x) ?? 0
    if (n > 0) left.set(x, n - 1)
    else diff++
  }
  for (const n of left.values()) diff += n
  return diff
}

export const storedKey = (e: { slot_time: string; therapist: string; raw_text: string }) =>
  `${e.slot_time.slice(0, 5)}|${e.therapist}|${e.raw_text}`
