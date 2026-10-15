// Synthetic names only.
import { describe, expect, it } from 'vitest'
import { parseContactsRows } from './contacts'
import { spreadsheetIdFromUrl, tabRange, tabUrl, toGrids } from './google-sheets'
import { parseScheduleGrids } from './schedule'

const URL = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0'

describe('sheet links', () => {
  it('reads the spreadsheet id and links to a tab', () => {
    expect(spreadsheetIdFromUrl(URL)).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789')
    expect(spreadsheetIdFromUrl('https://example.com')).toBeNull()
    expect(tabUrl(URL, 42)).toBe('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=42')
  })

  it('quotes tab titles in ranges', () => {
    expect(tabRange('Fri 16 OCT', 'A1:I36')).toBe("'Fri 16 OCT'!A1:I36")
    expect(tabRange("Kid's day", 'A1')).toBe("'Kid''s day'!A1")
  })
})

describe('live sheet values', () => {
  // The Sheets API drops trailing empty cells and returns dates as serial numbers.
  const dayValues: unknown[][] = [
    ['', '', '', '', '', '', '', '', 46311], // I1 = 2026-10-16 as a serial
    [],
    ['', 'Therapist A', '', 'Therapist B', '', 'Therapist C'],
    ['7h00 am', 'Jane Testerson 4 C'],
    ['7h30 am', '', '', 'Omar Sample X'],
  ]
  const { grids, contactsRows } = toGrids(
    [
      { title: 'Fri 16 OCT', gid: 11 },
      { title: 'Contacts', gid: 99 },
    ],
    [{ values: dayValues }, { values: [['Name', 'Phone'], ['Jane Testerson', 96171000001]] }],
  )

  it('feeds the same parser as the file upload', () => {
    const [day] = parseScheduleGrids(grids)
    expect(day.date).toBe('2026-10-16')
    expect(day.rows.map((r) => [r.slotTime, r.therapist, r.booking?.name, r.booking?.status, r.booking?.sessionNo])).toEqual([
      ['07:00', 'Therapist A', 'Jane Testerson', 'confirmed', 4],
      ['07:30', 'Therapist B', 'Omar Sample', 'cancelled', null],
    ])
  })

  it('separates the Contacts tab', () => {
    expect(grids.map((g) => g.name)).toEqual(['Fri 16 OCT'])
    expect(parseContactsRows(contactsRows!).contacts).toEqual([{ key: 'jane testerson', name: 'Jane Testerson', phone: '96171000001' }])
  })
})
