// Synthetic names only.
import { describe, expect, it } from 'vitest'
import { utils } from 'xlsx'
import { parseOldDailyReports } from './old-daily-report'

function day(rows: unknown[][]) {
  return utils.aoa_to_sheet([
    [null, null, 'Daily Report'],
    ...Array(9).fill([]),
    ['Client Name', 'Therapist', 'Info', 'Amount Paid', 'Amount Billed', 'Notes', null, 'Expense Details', 'Amount'],
    ...rows,
  ])
}

describe('parseOldDailyReports', () => {
  const wb = utils.book_new()
  utils.book_append_sheet(
    wb,
    day([
      ['Jane Testerson', 'Therapist A', 'Package', null, 38, 'Client is satisfied with session'],
      ['Omar Sample', 'Therapist B', 'Cash', 45, 45],
      ['Lina Example', 'Therapist A', 'POS 45$', 45, 45],
      ['Rami Testa', 'Therapist C', null, null, null],
      [null],
      ['Maintenance Follow-Up'],
      ['Someone Else', 'Client did not answer the follow-up call'],
    ]),
    'Tue Sep 22',
  )
  utils.book_append_sheet(wb, day([['Jane Testerson', 'Therapist A', 'Insurance', 5, 25]]), 'Tue Oct 6 ')
  utils.book_append_sheet(wb, utils.aoa_to_sheet([['not a day']]), 'Summary')

  const days = parseOldDailyReports(wb, 2026)

  it('reads one day per dated tab, in date order', () => {
    expect(days.map((d) => d.date)).toEqual(['2026-09-22', '2026-10-06'])
  })

  it('reads the client table and stops before the follow-up section', () => {
    expect(days[0].rows.map((r) => [r.name, r.info, r.paid, r.billed])).toEqual([
      ['Jane Testerson', 'package', null, 38],
      ['Omar Sample', 'cash', 45, 45],
      ['Lina Example', 'pos', 45, 45],
      ['Rami Testa', 'blank', null, null],
    ])
    expect(days[1].rows[0]).toMatchObject({ info: 'insurance', paid: 5, billed: 25, therapist: 'Therapist A' })
  })
})
