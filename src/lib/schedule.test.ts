// Synthetic names only.
import { describe, expect, it } from 'vitest'
import { formatSlotTime, parseScheduleGrids, parseSlotTime } from './schedule'

describe('slot times', () => {
  it('parses the sheet labels', () => {
    expect(parseSlotTime('7h00 am')).toBe('07:00')
    expect(parseSlotTime('11h30 am')).toBe('11:30')
    expect(parseSlotTime('12h00 pm')).toBe('12:00')
    expect(parseSlotTime('12h30 am')).toBe('00:30')
    expect(parseSlotTime('7h30 pm')).toBe('19:30')
    expect(parseSlotTime('10h00 pm')).toBe('22:00')
    expect(parseSlotTime('Total Hrs of Sessions')).toBeNull()
  })

  it('formats them for the reminder', () => {
    expect(formatSlotTime('19:30')).toBe('7:30 PM')
    expect(formatSlotTime('07:00')).toBe('7:00 AM')
    expect(formatSlotTime('12:00')).toBe('12:00 PM')
  })
})

describe('parseScheduleGrids', () => {
  function dayTab(cells: Record<string, string>): unknown[][] {
    const rows: unknown[][] = Array.from({ length: 36 }, () => Array(9).fill(null))
    rows[0][8] = new Date(2026, 9, 16)
    rows[2][1] = 'Therapist A'
    rows[2][3] = 'Therapist B'
    rows[2][5] = 'Therapist C'
    for (let r = 3; r <= 32; r++) {
      const minutes = 7 * 60 + (r - 3) * 30
      const h = Math.floor(minutes / 60)
      rows[r][0] = `${h % 12 === 0 ? 12 : h % 12}h${String(minutes % 60).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
    }
    for (const [ref, text] of Object.entries(cells)) {
      rows[Number(ref.slice(1)) - 1]['ABCDEFG'.indexOf(ref[0])] = text
    }
    rows[33][0] = 'Total Hrs of Sessions'
    return rows
  }

  const days = parseScheduleGrids([
    { name: 'Fri 16 OCT', rows: dayTab({ B4: 'Jane Testerson 3 C', D4: 'Meeting', F25: 'Omar Sample / Lina Example X', C4: '=HYPERLINK("x")' }) },
    { name: 'Contacts', rows: [['Name', 'Phone']] },
  ])

  it('reads one day per dated tab', () => {
    expect(days).toHaveLength(1)
    expect(days[0]).toMatchObject({ date: '2026-10-16', sheetTab: 'Fri 16 OCT', therapists: ['Therapist A', 'Therapist B', 'Therapist C'] })
  })

  it('reads bookings with time, therapist and cell', () => {
    const rows = days[0].rows
    expect(rows.find((r) => r.cellRef === 'B4')).toMatchObject({
      slotTime: '07:00',
      therapist: 'Therapist A',
      isNonClient: false,
      booking: { name: 'Jane Testerson', status: 'confirmed', sessionNo: 3 },
    })
    expect(rows.find((r) => r.cellRef === 'D4')).toMatchObject({ isNonClient: true, booking: null })
    const shared = rows.filter((r) => r.cellRef === 'F25')
    expect(shared.map((r) => [r.slotTime, r.booking?.name, r.booking?.status])).toEqual([
      ['17:30', 'Omar Sample', 'cancelled'],
      ['17:30', 'Lina Example', 'cancelled'],
    ])
  })

  it('ignores the WhatsApp formula columns', () => {
    expect(days[0].rows.some((r) => r.cellRef.startsWith('C'))).toBe(false)
  })
})
