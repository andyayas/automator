// Parses one booking cell of the clinic schedule. The cells are free text typed
// by several people (CLAUDE.md "Cell grammar"):
//   "Firstname Lastname C"         confirmed
//   "Firstname Lastname 11 C"      session 11, confirmed ("C 11", "C11", "11C")
//   "Firstname Lastname X" / "R"   cancelled / rescheduled
//   "Firstname Lastname"           no status
//   "... 45$" / "... Insurance"    amount / billing type noted inline
//   "Name One / Name Two"          two clients in one slot

import { normalizeName } from './names'

export type BookingStatus = 'confirmed' | 'cancelled' | 'rescheduled' | 'unknown'

export type ParsedBooking = {
  /** Name as typed, with status/number/amount tokens removed. */
  name: string
  status: BookingStatus
  sessionNo: number | null
  amount: number | null
  billingNote: 'insurance' | 'free' | 'package' | 'pos' | 'cash' | null
}

export type ParsedCell =
  | { kind: 'empty' }
  | { kind: 'non-client'; text: string }
  | { kind: 'bookings'; bookings: ParsedBooking[] }

export type NonClientPattern = { pattern: string; match_type: 'exact' | 'contains' }

/** Default non-client entries (CLAUDE.md); the app keeps the editable list in the database. */
export const DEFAULT_NON_CLIENT_PATTERNS: NonClientPattern[] = [
  ...['meeting', 'off', 'closed', 'holiday', 'lunch', 'break', 'x', '-', 'labneh time'].map((pattern) => ({
    pattern,
    match_type: 'exact' as const,
  })),
  ...['app with', 'meeting with', 'consultation with', 'outdoor', 'inbody test', 'staff'].map((pattern) => ({
    pattern,
    match_type: 'contains' as const,
  })),
]

const STATUS: Record<string, BookingStatus> = { c: 'confirmed', x: 'cancelled', r: 'rescheduled' }
const BILLING = new Set(['insurance', 'free', 'package', 'pos', 'cash'])

export function isNonClient(text: string, patterns: NonClientPattern[], staffNames: string[] = []): boolean {
  const lower = text.toLowerCase().replace(/\s+/g, ' ').trim()
  const normalized = normalizeName(text)
  return (
    patterns.some((p) => (p.match_type === 'exact' ? lower === p.pattern : lower.includes(p.pattern))) ||
    staffNames.some((s) => normalizeName(s) === normalized)
  )
}

export function parseScheduleCell(
  raw: unknown,
  patterns: NonClientPattern[] = DEFAULT_NON_CLIENT_PATTERNS,
  staffNames: string[] = [],
): ParsedCell {
  if (raw === null || raw === undefined) return { kind: 'empty' }
  const text = String(raw).replace(/\s+/g, ' ').trim()
  if (!text) return { kind: 'empty' }
  if (isNonClient(text, patterns, staffNames)) return { kind: 'non-client', text }

  const parts = text.split('/').map((p) => p.trim()).filter(Boolean)
  const bookings = parts.map(parseBooking).filter((b) => b.name)
  if (!bookings.length) return { kind: 'non-client', text }

  // "Name One / Name Two C": a status typed once at the end applies to both.
  const last = bookings[bookings.length - 1]
  for (const b of bookings) if (b.status === 'unknown' && last.status !== 'unknown') b.status = last.status
  return { kind: 'bookings', bookings }
}

function parseBooking(part: string): ParsedBooking {
  const booking: ParsedBooking = { name: '', status: 'unknown', sessionNo: null, amount: null, billingNote: null }
  // "LastnameC": an uppercase status letter glued to a lowercase letter.
  const unglued = part.replace(/([a-z])([CXR])(\d{0,2})$/, '$1 $2$3')
  const nameTokens: string[] = []

  for (const token of unglued.split(' ')) {
    const lower = token.toLowerCase()
    let m: RegExpMatchArray | null
    if (nameTokens.length && STATUS[lower]) {
      booking.status = STATUS[lower]
    } else if (nameTokens.length && (m = lower.match(/^([cxr])(\d{1,2})$|^(\d{1,2})([cxr])$/))) {
      booking.status = STATUS[m[1] ?? m[4]]
      booking.sessionNo = Number(m[2] ?? m[3])
    } else if ((m = lower.match(/^\$?(\d+(?:\.\d+)?)\$$|^\$(\d+(?:\.\d+)?)$/))) {
      booking.amount = Number(m[1] ?? m[2])
    } else if (nameTokens.length && /^\d{1,2}$/.test(lower)) {
      booking.sessionNo = Number(lower)
    } else if (nameTokens.length && BILLING.has(lower)) {
      booking.billingNote = lower as ParsedBooking['billingNote']
    } else {
      nameTokens.push(token)
    }
  }
  booking.name = nameTokens.join(' ')
  return booking
}
