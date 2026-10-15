// Synthetic names only.
import { describe, expect, it } from 'vitest'
import { createNameMatcher } from './names'
import type { ScheduleDay, ScheduleRow } from './schedule'
import { planScheduleImport } from './schedule-import'

function row(date: string, cellRef: string, raw: string, booking: ScheduleRow['booking']): ScheduleRow {
  return { date, slotTime: '09:00', slotLabel: '9h00 am', therapist: 'Therapist A', sheetTab: 'tab', cellRef, rawText: raw, isNonClient: !booking, booking }
}
const b = (name: string, status: 'confirmed' | 'unknown' = 'confirmed', sessionNo: number | null = null) => ({
  name,
  status,
  sessionNo,
  amount: null,
  billingNote: null,
})

const match = createNameMatcher(
  [
    { id: 'c1', name: 'Jane Testerson' },
    { id: 'c2', name: 'Omar Sample' },
    { id: 'c3', name: 'Rami Testa' },
    { id: 'c4', name: 'Rima Testa' },
  ],
  new Map([['jt', 'c1']]),
)

describe('planScheduleImport', () => {
  const days: ScheduleDay[] = [
    {
      date: '2026-10-16',
      sheetTab: 'Fri 16 OCT',
      therapists: ['Therapist A'],
      rows: [
        row('2026-10-16', 'B4', 'Jane Testerson 3 C', b('Jane Testerson', 'confirmed', 3)),
        row('2026-10-16', 'B5', 'JT', b('JT')),
        row('2026-10-16', 'B6', 'Omar Sampel', b('Omar Sampel', 'unknown')),
        row('2026-10-16', 'B7', 'Rama Testa', b('Rama Testa')),
        row('2026-10-16', 'B8', 'New Person C', b('New Person')),
        row('2026-10-16', 'B9', 'New Person C', b('New Person')),
        row('2026-10-16', 'D4', 'Meeting', null),
      ],
    },
    {
      date: '2026-10-15',
      sheetTab: 'Thu 15 OCT',
      therapists: ['Therapist A'],
      rows: [row('2026-10-15', 'B4', 'Jane Testerson C', b('Jane Testerson'))],
    },
  ]

  const plan = planScheduleImport(days, match, new Set(['2026-10-15']), new Map([['2026-10-15', ['09:00|Therapist A|Jane Testerson X']]]))
  const rows = plan.replace.get('2026-10-16')!

  it('matches by alias, exact name and fuzzy spelling', () => {
    expect(rows.find((r) => r.cell_ref === 'B4')).toMatchObject({ client_id: 'c1', match_kind: 'exact', session_no: 3, status: 'confirmed' })
    expect(rows.find((r) => r.cell_ref === 'B5')).toMatchObject({ client_id: 'c1', match_kind: 'alias' })
    expect(rows.find((r) => r.cell_ref === 'B6')).toMatchObject({ client_id: 'c2', match_kind: 'fuzzy', status: 'unknown' })
  })

  it('never guesses between two close clients', () => {
    expect(rows.find((r) => r.cell_ref === 'B7')).toMatchObject({ client_id: null, match_kind: 'none' })
  })

  it('keeps non-client entries, without a client', () => {
    const meeting = rows.find((r) => r.cell_ref === 'D4')!
    expect(meeting.is_non_client).toBe(true)
    expect(meeting.client_id ?? null).toBeNull()
  })

  it('counts matches and lists unknown names', () => {
    expect(plan).toMatchObject({ bookings: 6, matched: 2, uncertain: 1, unmatched: 3 })
    expect(plan.unmatchedNames).toEqual([
      { name: 'New Person', count: 2 },
      { name: 'Rama Testa', count: 1 },
    ])
  })

  it('leaves confirmed days alone and reports their differences', () => {
    expect(plan.replace.has('2026-10-15')).toBe(false)
    expect(plan.confirmedChanged).toEqual([{ date: '2026-10-15', differences: 2 }])
  })
})
