// Synthetic rows only.
import { describe, expect, it } from 'vitest'
import { emptyEdits } from './day-edits'
import type { DayRow } from './day-builder'
import { lateCash, takeLateCash, type LateCashInput } from './late-cash'

const line = (over: Partial<LateCashInput>): LateCashInput => ({
  id: 'x',
  date: '2026-10-29',
  created_at: '2026-10-29T10:00:00+00:00',
  missing_from_source: false,
  kind: 'session',
  name_raw: 'testa person',
  description: 'single physio session',
  debit: 45,
  credit: null,
  pos_amount: null,
  ...over,
})

describe('lateCash', () => {
  const reviews = [
    { date: '2026-10-29', confirmed_at: '2026-10-29T20:00:00.000Z' },
    { date: '2026-10-30', confirmed_at: null },
  ]

  it('lists lines added after the day was confirmed', () => {
    const late = lateCash(reviews, [
      line({ id: 'before' }),
      line({ id: 'after', created_at: '2026-11-01T13:00:00+00:00', name_raw: 'testb person', debit: 80 }),
      line({ id: 'open day', date: '2026-10-30', created_at: '2026-11-01T13:00:00+00:00' }),
    ])
    expect(late).toEqual([{ date: '2026-10-29', lines: [expect.objectContaining({ id: 'after' })] }])
  })

  it('ignores lines that only came back under a new key', () => {
    const late = lateCash(reviews, [
      line({ id: 'old copy', missing_from_source: true, kind: 'expense', name_raw: 'acme', description: 'delivery', debit: null, credit: 4 }),
      line({ id: 'new copy', created_at: '2026-10-31T09:00:00+00:00', kind: 'expense', name_raw: 'acme', description: 'delivery', debit: null, credit: 4 }),
    ])
    expect(late).toEqual([])
  })
})

describe('takeLateCash', () => {
  it('lets a row with new money take the cash statement amount, keeping the rest as confirmed', () => {
    const rows = [
      { key: 'entry:a', cashIds: ['late'] },
      { key: 'entry:b', cashIds: ['old'] },
    ] as DayRow[]
    const edits = { ...emptyEdits(), rows: { 'entry:a': { collected: 0, billed: 45 }, 'entry:b': { collected: 40 } } }
    const next = takeLateCash(edits, rows, new Set(['late']))
    expect(next.rows).toEqual({ 'entry:a': { billed: 45 }, 'entry:b': { collected: 40 } })
  })
})
