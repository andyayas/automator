// Reads a schedule workbook (the clinic's Google Sheet, exported or read live):
// one tab per working day, I1 = date, row 3 = therapist names in B/D/F,
// rows 4–33 = half-hour slots ("7h00 am" … "10h00 pm"). Columns C/E/G hold the
// sheet's own WhatsApp formulas and are ignored.

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

const BOOKING_COLUMNS = [1, 3, 5] // B, D, F
const COLUMN_LETTERS = 'ABCDEFGHIJ'
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

/**
 * Parses day tabs given as grids of cell values (from SheetJS or the Sheets
 * API). Tabs without a date in I1 (e.g. Contacts) are skipped.
 */
export function parseScheduleGrids(
  sheets: SheetGrid[],
  opts: { patterns?: NonClientPattern[]; staffNames?: string[] } = {},
): ScheduleDay[] {
  const days: ScheduleDay[] = []
  for (const { name, rows } of sheets) {
    if (name.trim().toLowerCase() === 'contacts') continue
    const date = toISODate(rows[0]?.[8])
    if (!date) continue
    const therapists = BOOKING_COLUMNS.map((c) => String(rows[2]?.[c] ?? '').trim())
    const day: ScheduleDay = { date, sheetTab: name, therapists, rows: [] }

    for (let r = FIRST_SLOT_ROW; r <= LAST_SLOT_ROW; r++) {
      const slotLabel = String(rows[r]?.[0] ?? '').trim()
      const slotTime = parseSlotTime(slotLabel)
      if (!slotTime) continue
      BOOKING_COLUMNS.forEach((c, t) => {
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
