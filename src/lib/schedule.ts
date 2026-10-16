// Reads a schedule workbook (the clinic's Google Sheet, exported or read live):
// one tab per working day named like "Tue 22 SEP", row 3 = therapist names,
// rows 4–33 = half-hour slots ("7h00 am" … "10h00 pm").
//
// Two layouts exist. Until mid-October 2026 the therapists were in B/D/F with
// WhatsApp-link formulas in C/E/G (no name in row 3 above them) and the date
// in I1. The cleaned sheet has the therapists side by side (B/C/D…) and no
// date cell. So therapist columns are whichever row-3 cells hold a name, and
// the date comes from I1 when present, else from the tab name.

import { toISODate } from './dates'
import { normalizeName } from './names'
import { parseScheduleCell, type BookingStatus, type NonClientPattern, type ParsedBooking } from './schedule-cell'

export type ScheduleRow = {
  date: string
  /** "HH:MM", 24-hour. */
  slotTime: string
  /** As written in column A, e.g. "7h30 pm". */
  slotLabel: string
  therapist: string
  sheetTab: string
  cellRef: string
  rawText: string
  isNonClient: boolean
  booking: ParsedBooking | null
}

export type ScheduleDay = { date: string; sheetTab: string; therapists: string[]; rows: ScheduleRow[] }

const COLUMN_LETTERS = 'ABCDEFGHIJ'
const LAST_THERAPIST_COLUMN = 8 // I: the widest the sheet has ever been
const FIRST_SLOT_ROW = 3 // 0-based: row 4
const LAST_SLOT_ROW = 32 // row 33

/** "7h00 am" -> "07:00", "12h30 pm" -> "12:30", "10h00 pm" -> "22:00". */
export function parseSlotTime(label: unknown): string | null {
  const m = /^(\d{1,2})\s*[h:.]\s*(\d{2})\s*(am|pm)?$/i.exec(String(label ?? '').trim())
  if (!m) return null
  let hour = Number(m[1])
  const minute = Number(m[2])
  const ampm = m[3]?.toLowerCase()
  if (ampm === 'pm' && hour < 12) hour += 12
  if (ampm === 'am' && hour === 12) hour = 0
  if (hour > 23 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** "19:30" -> "7:30 PM" (the reminder message format). */
export function formatSlotTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export type SheetGrid = { name: string; rows: unknown[][] }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * "Tue 22 SEP" -> "2026-09-22". The tab has no year: it comes from `year`
 * (the sheet's month, or a year in its title), else the year that puts the
 * date nearest to `today`.
 */
export function dateFromTabName(name: string, year?: number | null, today = new Date()): string | null {
  const m = /^\s*[a-z]{3,}\.?\s+(\d{1,2})\s+([a-z]{3,})\.?\s*$/i.exec(name)
  if (!m) return null
  const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase())
  const day = Number(m[1])
  if (month < 0 || day < 1 || day > 31) return null
  const pick = (y: number) => new Date(y, month, day)
  let y = year ?? today.getFullYear()
  if (!year) {
    // Nearest to today: a January tab read in December is next year, and so on.
    const best = [y - 1, y, y + 1].reduce((a, b) => (Math.abs(+pick(b) - +today) < Math.abs(+pick(a) - +today) ? b : a))
    y = best
  }
  const d = pick(y)
  if (d.getMonth() !== month) return null // e.g. 31 SEP
  return `${y}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** The columns with a therapist's name in row 3 (B onwards). */
function therapistColumns(rows: unknown[][]): number[] {
  const cols: number[] = []
  for (let c = 1; c <= LAST_THERAPIST_COLUMN; c++) {
    const v = rows[2]?.[c]
    if (typeof v === 'string' && v.trim() && !toISODate(v)) cols.push(c)
  }
  return cols
}

/**
 * Parses day tabs given as grids of cell values (from SheetJS or the Sheets
 * API). Tabs that aren't a dated day (e.g. Contacts) are skipped.
 */
export function parseScheduleGrids(
  sheets: SheetGrid[],
  opts: { patterns?: NonClientPattern[]; staffNames?: string[]; year?: number | null; today?: Date } = {},
): ScheduleDay[] {
  const days: ScheduleDay[] = []
  for (const { name, rows } of sheets) {
    if (name.trim().toLowerCase() === 'contacts') continue
    const date = toISODate(rows[0]?.[8]) ?? dateFromTabName(name, opts.year, opts.today)
    if (!date) continue
    const columns = therapistColumns(rows)
    if (!columns.length) continue
    const therapists = columns.map((c) => String(rows[2]?.[c] ?? '').trim())
    const day: ScheduleDay = { date, sheetTab: name, therapists, rows: [] }

    for (let r = FIRST_SLOT_ROW; r <= LAST_SLOT_ROW; r++) {
      const slotLabel = String(rows[r]?.[0] ?? '').trim()
      const slotTime = parseSlotTime(slotLabel)
      if (!slotTime) continue
      columns.forEach((c, t) => {
        const cell = parseScheduleCell(rows[r]?.[c], opts.patterns, opts.staffNames)
        if (cell.kind === 'empty') return
        const base = {
          date,
          slotTime,
          slotLabel,
          therapist: therapists[t] || `Column ${COLUMN_LETTERS[c]}`,
          sheetTab: name,
          cellRef: `${COLUMN_LETTERS[c]}${r + 1}`,
          rawText: String(rows[r][c]).trim(),
        }
        if (cell.kind === 'non-client') day.rows.push({ ...base, isNonClient: true, booking: null })
        else for (const booking of cell.bookings) day.rows.push({ ...base, isNonClient: false, booking })
      })
    }
    days.push(day)
  }
  return days.sort((a, b) => a.date.localeCompare(b.date))
}

export const STATUS_LETTER: Record<BookingStatus, string> = { confirmed: 'C', cancelled: 'X', rescheduled: 'R', unknown: '?' }

export const bookingKey = (name: string) => normalizeName(name)
