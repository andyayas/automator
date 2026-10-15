// Synthetic rows only.
import { describe, expect, it } from 'vitest'
import { utils } from 'xlsx'
import { amountIn, parseCashStatement, toISODate } from './cash-statement'

const HEAD = ['Date', 'Client Name', 'Description', 'Receipt/PV', 'Debit in $', 'Credit in $', 'Balance in $']

/** A month tab with the header on row 3 and data from row 7, starting at `offset` columns. */
function tab(rows: unknown[][], offset = 3) {
  const pad = (r: unknown[]) => [...Array(offset).fill(null), ...r]
  return utils.aoa_to_sheet([[], [], pad(HEAD), [], [], pad([null, null, null, null, null, null, 100]), ...rows.map(pad)])
}

function book(tabs: Record<string, unknown[][]>, offsets: Record<string, number> = {}) {
  const wb = utils.book_new()
  for (const [name, rows] of Object.entries(tabs)) utils.book_append_sheet(wb, tab(rows, offsets[name]), name)
  return wb
}

describe('parseCashStatement', () => {
  const wb = book(
    {
      August: [[new Date(2026, 7, 31), 'testa person', 'single physio session', 'rc 99', 45, null]],
      September: [
        [new Date(2026, 8, 1), 'testa person ', 'single physio session', 'rc1', 45, null],
        [null, 'testb sample', 'Package of 12 session POS 450$', 'rc2', null, null],
        [null, 'acme water', '5 boxes of water', 'pv1', null, 12],
        [null, 'testc example', 'insurance difference', 'rc3', 5, null],
        [null, 'TestInsure', 'payment', 'rc4', 900, null],
        ['2-sep-26', 'testd person', 'last payment of the package', 'rc5', 150, null],
        [null, 'teste person', 'single physio session 45$ wish', null, null, null],
        [new Date(2029, 8, 3), 'testf person', 'single physio session', 'rc6', 45, null],
        [null, null, 'Description', null, null, null],
        [null, null, 'Total', null, 1100, 12],
      ],
    },
    { August: 4 },
  )
  const { rows, skipped, sheets, fixedDates } = parseCashStatement(wb, { insurers: ['testinsure'] })
  const by = (v: string) => rows.find((r) => r.voucher === v)!

  it('finds the columns from the headers, even when they move', () => {
    expect(sheets).toEqual(['August', 'September'])
    expect(rows[0]).toMatchObject({ sheet: 'August', date: '2026-08-31', voucher: 'rc99', debit: 45 })
  })

  it('carries the date down and reads text dates', () => {
    expect(by('rc2').date).toBe('2026-09-01')
    expect(by('rc5').date).toBe('2026-09-02')
    expect(rows.find((r) => r.method === 'transfer')!.date).toBe('2026-09-02')
  })

  it('classifies rows', () => {
    expect(by('rc1')).toMatchObject({ kind: 'session', method: 'cash', nameRaw: 'testa person' })
    expect(by('rc2')).toMatchObject({ kind: 'package', method: 'pos', descAmount: 450, packageSessions: 12 })
    expect(by('pv1')).toMatchObject({ kind: 'expense', credit: 12 })
    expect(by('rc3')).toMatchObject({ kind: 'insurance_copay' })
    expect(by('rc4')).toMatchObject({ kind: 'insurer_payment' })
    expect(by('rc5')).toMatchObject({ kind: 'package', packageSessions: null })
    expect(by('rc5').date).toBe('2026-09-02')
    expect(rows.find((r) => r.method === 'transfer')).toMatchObject({ voucher: null, descAmount: 45, kind: 'session' })
  })

  it('skips repeated headers and totals', () => {
    expect(skipped).toBe(2)
    expect(rows).toHaveLength(9)
  })

  it('fixes a mistyped year and says so', () => {
    expect(by('rc6').date).toBe('2026-09-03')
    expect(by('rc6').sourceKey).toBe('2026-09-03|rc6')
    expect(fixedDates).toHaveLength(1)
    expect(fixedDates[0]).toMatch(/^September row \d+: 2029-09-03 read as 2026-09-03$/)
  })

  it('keys rows by date + voucher so recycled voucher numbers stay distinct', () => {
    expect(by('rc1').sourceKey).toBe('2026-09-01|rc1')
    expect(new Set(rows.map((r) => r.sourceKey)).size).toBe(rows.length)
  })
})

describe('helpers', () => {
  it('reads amounts written in descriptions', () => {
    expect(amountIn('Package of 12 session POS 450$')).toBe(450)
    expect(amountIn('single physio session 45$POS')).toBe(45)
    expect(amountIn('paid $37.5 by card')).toBe(37.5)
    expect(amountIn('Package of 12')).toBeNull()
  })

  it('parses date cells', () => {
    expect(toISODate(new Date(2026, 9, 7))).toBe('2026-10-07')
    expect(toISODate('15-sep-26')).toBe('2026-09-15')
    expect(toISODate(46300)).toMatch(/^2026-/)
    expect(toISODate('carried forward')).toBeNull()
  })
})
