// Synthetic data only.
import { describe, expect, it } from 'vitest'
import { planCashImport, proposalStartDate, type StoredCash } from './cash-import'
import type { CashRow } from './cash-statement'
import { createNameMatcher } from './names'

function cash(over: Partial<CashRow>): CashRow {
  return {
    sheet: 'October',
    row: 7,
    date: '2026-10-01',
    nameRaw: 'jane testerson',
    description: 'single physio session',
    voucher: 'rc1',
    debit: 45,
    credit: null,
    method: 'cash',
    descAmount: null,
    kind: 'session',
    packageSessions: null,
    balance: null,
    sourceKey: '2026-10-01|rc1',
    ...over,
  }
}

const stored = (over: Partial<StoredCash>): StoredCash => ({
  id: 's1',
  date: '2026-10-01',
  source_key: '2026-10-01|rc1',
  balance: null,
  name_raw: 'jane testerson',
  description: 'single physio session',
  debit: 45,
  credit: null,
  method: 'cash',
  pos_amount: null,
  kind: 'session',
  missing_from_source: false,
  ...over,
})

const match = createNameMatcher([
  { id: 'c1', name: 'Jane Testerson' },
  { id: 'c2', name: 'Omar Sample' },
])
const nameOf = (id: string) => ({ c1: 'Jane Testerson', c2: 'Omar Sample' })[id] ?? id

describe('planCashImport', () => {
  it('skips unchanged rows, updates changed ones and flags missing ones', () => {
    const plan = planCashImport(
      [cash({}), cash({ sourceKey: '2026-10-01|rc2', voucher: 'rc2', debit: 50 })],
      [stored({}), stored({ id: 's2', source_key: '2026-10-01|rc2', debit: 45 }), stored({ id: 's3', source_key: '2026-09-30|rc9' })],
      match,
      nameOf,
      [],
      '2000-01-01',
    )
    expect(plan.unchanged).toBe(1)
    expect(plan.changes).toMatchObject([{ id: 's2', fields: ['debit'] }])
    expect(plan.missing).toEqual(['s3'])
    expect(plan.inserts).toEqual([])
  })

  it('inserts new rows linked to the client', () => {
    const plan = planCashImport([cash({ sourceKey: 'new|rc5', voucher: 'rc5' })], [], match, nameOf, [], '2000-01-01')
    expect(plan.inserts).toMatchObject([{ source_key: 'new|rc5', client_id: 'c1', kind: 'session', method: 'cash' }])
  })

  it('proposes a package for a new "Package of N" receipt, once', () => {
    const pkgRow = cash({
      sourceKey: '2026-10-02|rc6',
      voucher: 'rc6',
      date: '2026-10-02',
      nameRaw: 'omar sample',
      description: 'Package of 12 POS 450$',
      debit: null,
      descAmount: 450,
      method: 'pos',
      kind: 'package',
      packageSessions: 12,
    })
    const plan = planCashImport([pkgRow], [], match, nameOf, [], '2026-10-01')
    expect(plan.packageProposals).toMatchObject([{ clientId: 'c2', sessions: 12, price: 450, date: '2026-10-02', voucher: 'rc6' }])

    const again = planCashImport([pkgRow], [], match, nameOf, [{ client_id: 'c2', purchased_on: '2026-10-02', sessions_total: 12 }], '2026-10-01')
    expect(again.packageProposals).toEqual([])
  })

  it('lists package payers it cannot match', () => {
    const plan = planCashImport(
      [cash({ sourceKey: 'k', nameRaw: 'someone unknown', kind: 'package', packageSessions: 10, description: 'package of 10' })],
      [],
      match,
      nameOf,
      [],
      '2000-01-01',
    )
    expect(plan.packageProposals).toEqual([])
    expect(plan.unmatchedPackages).toHaveLength(1)
  })

  it('does not link expenses to clients', () => {
    const plan = planCashImport([cash({ sourceKey: 'e', nameRaw: 'jane testerson', kind: 'expense', debit: null, credit: 10 })], [], match, nameOf, [], '2000-01-01')
    expect(plan.inserts[0].client_id).toBeNull()
  })

  it('does not propose old receipts (history)', () => {
    const old = cash({ sourceKey: 'o', nameRaw: 'omar sample', kind: 'package', packageSessions: 12, date: '2026-03-01', description: 'package of 12' })
    expect(planCashImport([old], [], match, nameOf, [], '2026-10-01').packageProposals).toEqual([])
  })

  it('proposes from the day after the newest stored receipt, or the last 14 days on a first upload', () => {
    expect(proposalStartDate(['2026-10-05', '2026-10-07', '2026-09-30'], '2026-10-15')).toBe('2026-10-08')
    expect(proposalStartDate([], '2026-10-15')).toBe('2026-10-01')
  })
})

describe('running balance', () => {
  it('saves a new or changed balance quietly, without listing the row as changed', () => {
    const plan = planCashImport(
      [cash({ balance: 1250 }), cash({ sourceKey: '2026-10-01|rc2', voucher: 'rc2', balance: 1300 })],
      [stored({ balance: null }), stored({ id: 's2', source_key: '2026-10-01|rc2', balance: 1300 })],
      match,
      nameOf,
      [],
      '2026-10-15',
    )
    expect(plan.balances).toEqual([{ id: 's1', balance: 1250 }])
    expect(plan.changes).toEqual([])
    expect(plan.unchanged).toBe(2)
  })

  it('keeps it with the other fields when the row changed anyway, and ignores old months', () => {
    const plan = planCashImport(
      [cash({ debit: 50, balance: 900 }), cash({ sourceKey: '2026-01-05|rc3', voucher: 'rc3', date: '2026-01-05', balance: 10 })],
      [stored({ debit: 45 }), stored({ id: 's3', source_key: '2026-01-05|rc3', date: '2026-01-05' })],
      match,
      nameOf,
      [],
      '2026-10-15',
    )
    expect(plan.changes).toMatchObject([{ id: 's1', fields: ['debit'], values: { balance: 900 } }])
    expect(plan.balances).toEqual([])
  })
})
