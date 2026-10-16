// Synthetic therapist names only.
import { describe, expect, it } from 'vitest'
import { buildMonthSheet, DESIGN, missingSheetMonth, monthTitle, nextMonth, workingDayTabs } from './month-sheet'
import { parseScheduleGrids } from './schedule'

describe('next month’s sheet', () => {
  it('has one tab per working day, named like the clinic’s', () => {
    const tabs = workingDayTabs('2026-11')
    expect(tabs[0]).toBe('Mon 2 NOV') // 1 Nov 2026 is a Sunday
    expect(tabs.at(-1)).toBe('Mon 30 NOV')
    expect(tabs).toHaveLength(25)
    expect(tabs.some((t) => t.startsWith('Sun'))).toBe(false)
    expect(monthTitle('2026-11')).toBe('November 2026')
    expect(nextMonth('2026-12')).toBe('2027-01')
  })

  it('knows which month is still missing', () => {
    expect(missingSheetMonth({}, '2026-10-26')).toBe('2026-10')
    expect(missingSheetMonth({ '2026-10': 'x' }, '2026-10-26')).toBe('2026-11')
    expect(missingSheetMonth({ '2026-10': 'x', '2026-11': 'y' }, '2026-10-26')).toBeNull()
  })

  const body = buildMonthSheet('2026-11', ['Therapist A', 'Therapist B', 'Therapist C'])
  const first = body.sheets[0]
  const rows = first.data[0].rowData

  it('lays out the clinic’s design: title, therapists, 7 am–10 pm slots, totals and notes', () => {
    expect(body.properties.title).toBe('Physio November 2026')
    expect(rows[0].values[0].userEnteredFormat).toMatchObject({ horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' })
    expect(first.properties.title).toBe('Mon 2 NOV')
    expect(first.merges[0]).toMatchObject({ startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 4 })
    const text = (r: number, c: number) => rows[r].values[c].userEnteredValue?.stringValue
    expect(text(0, 0)).toBe('Physio Name')
    expect([text(2, 0), text(2, 1), text(2, 2), text(2, 3)]).toEqual(['Time', 'Therapist A', 'Therapist B', 'Therapist C'])
    expect(text(3, 0)).toBe('7h00 am')
    expect(text(32, 0)).toBe('10h00 pm')
    expect([text(33, 0), text(35, 0)]).toEqual(['Total Hrs of Sessions', 'Notes'])
    expect(rows).toHaveLength(36)
    expect(rows[10].values[2].userEnteredValue).toBeUndefined() // booking cells start empty
  })

  it('uses the clinic’s colours and wider therapist columns', () => {
    expect(rows[2].values[1].userEnteredFormat.backgroundColor).toEqual(DESIGN.colours.therapist)
    expect(rows[33].values[0].userEnteredFormat.backgroundColor).toEqual(DESIGN.colours.footer)
    expect(first.data[0].columnMetadata.map((c) => c.pixelSize)).toEqual([145, 190, 190, 190])
  })

  it('reads back with the app’s own schedule reader', () => {
    const grids = body.sheets.map((s) => ({
      name: s.properties.title,
      rows: s.data[0].rowData.map((r) => r.values.map((v) => v.userEnteredValue?.stringValue ?? null)),
    }))
    grids[0].rows[5][2] = 'Jane Testerson C' // 8h00 am, Therapist B
    const days = parseScheduleGrids(grids, { year: 2026 })
    expect(days).toHaveLength(25)
    expect(days[0]).toMatchObject({ date: '2026-11-02', therapists: ['Therapist A', 'Therapist B', 'Therapist C'] })
    expect(days[0].rows[0]).toMatchObject({ slotTime: '08:00', therapist: 'Therapist B', booking: { name: 'Jane Testerson' } })
  })
})
