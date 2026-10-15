// Synthetic names only.
import { describe, expect, it } from 'vitest'
import type { ApprovalWithBalance, PackageWithBalance } from './api'
import { buildDayDraft, type CashInput, type DayInputs, type EntryInput } from './day-builder'
import { applyEdits, emptyEdits, toReportData } from './day-edits'
import { monthReportDays } from './month-report'

const base = {
  owner_id: 'u',
  created_at: '',
  updated_at: '',
  notes: null,
  used_before_app_as_of: null,
  sessions_used_in_app: 0,
  last_session_on: null,
  client: null,
}

const pkg = (id: string, clientId: string, used: number, total = 10, status: PackageWithBalance['status'] = 'active'): PackageWithBalance => ({
  ...base,
  id,
  client_id: clientId,
  status,
  sessions_total: total,
  sessions_used_before_app: used,
  sessions_used: used,
  sessions_remaining: total - used,
  price_total: 400,
  per_session: 40,
  amount_paid: 400,
  purchased_on: '2026-09-01',
  source_voucher: null,
})

const approval = (id: string, clientId: string, used: number, validUntil: string | null = null): ApprovalWithBalance => ({
  ...base,
  id,
  client_id: clientId,
  status: 'active',
  insurer: 'Test Insurer',
  serial_number: 'S-1',
  sessions_approved: 10,
  sessions_used_before_app: used,
  sessions_used: used,
  sessions_remaining: 10 - used,
  billed_per_session: 25,
  copay_per_session: 5,
  approved_on: '2026-09-01',
  valid_until: validUntil,
})

let n = 0
const entry = (over: Partial<EntryInput>): EntryInput => ({
  id: `e${++n}`,
  slot_time: '09:00:00',
  therapist: 'Therapist A',
  parsed_name: 'Someone',
  raw_text: 'Someone C',
  status: 'confirmed',
  session_no: null,
  billing_note: null,
  is_non_client: false,
  client_id: null,
  match_kind: 'exact',
  ...over,
})
const cash = (over: Partial<CashInput>): CashInput => ({
  id: `c${++n}`,
  name_raw: 'someone',
  description: 'single physio session',
  debit: 45,
  credit: null,
  method: 'cash',
  pos_amount: null,
  kind: 'session',
  client_id: null,
  ...over,
})

function inputs(over: Partial<DayInputs>): DayInputs {
  return {
    date: '2026-10-16',
    entries: [],
    cash: [],
    packages: [],
    approvals: [],
    clientNames: new Map([
      ['jane', 'Jane Testerson'],
      ['omar', 'Omar Sample'],
      ['lina', 'Lina Example'],
      ['rami', 'Rami Testa'],
    ]),
    expenseLabels: new Map([['acme water|5 boxes of water', 'Water 5 boxes']]),
    defaults: { perSessionPrice: 45, insuranceBilled: 25 },
    ...over,
  }
}

describe('buildDayDraft', () => {
  it('bills a paid per-session client from the cash statement', () => {
    const d = buildDayDraft(inputs({ entries: [entry({ client_id: 'jane' })], cash: [cash({ client_id: 'jane', debit: 40 })] }))
    expect(d.rows[0]).toMatchObject({ clientName: 'Jane Testerson', billingType: 'per_session', billed: 40, collected: 40, paymentMethod: 'cash', flags: [] })
  })

  it('uses the package and counts the session number', () => {
    const d = buildDayDraft(inputs({ entries: [entry({ client_id: 'omar', session_no: 5 })], packages: [pkg('p1', 'omar', 4)] }))
    expect(d.rows[0]).toMatchObject({ billingType: 'package', packageId: 'p1', billed: 40, collected: 0, sessionNo: 5, flags: [] })
  })

  it('flags a session number that disagrees with the sheet, and a used-up package', () => {
    const d = buildDayDraft(inputs({ entries: [entry({ client_id: 'omar', session_no: 3 })], packages: [pkg('p1', 'omar', 10)] }))
    expect(d.rows[0].flags.map((f) => f.kind)).toEqual(['exhausted', 'session-mismatch'])
  })

  it('bills insurance from the approval and the co-pay from cash', () => {
    const d = buildDayDraft(
      inputs({
        entries: [entry({ client_id: 'lina' })],
        cash: [cash({ client_id: 'lina', kind: 'insurance_copay', description: 'insurance difference', debit: 5 })],
        approvals: [approval('a1', 'lina', 2, '2026-10-10')],
      }),
    )
    expect(d.rows[0]).toMatchObject({ billingType: 'insurance', approvalId: 'a1', serialNumber: 'S-1', billed: 25, collected: 5, sessionNo: 3 })
    expect(d.rows[0].flags.map((f) => f.kind)).toEqual(['expired'])
  })

  it('leaves cancelled and rescheduled bookings out of the day', () => {
    const d = buildDayDraft(inputs({ entries: [entry({ client_id: 'jane', status: 'cancelled' }), entry({ client_id: 'omar', status: 'rescheduled' })] }))
    expect(d.rows).toEqual([])
    expect(d.excluded.map((r) => r.status)).toEqual(['cancelled', 'rescheduled'])
  })

  it('flags unknown names, missing status and missing payment', () => {
    const d = buildDayDraft(inputs({ entries: [entry({ client_id: null, match_kind: 'none', parsed_name: 'new person', status: 'unknown' })] }))
    expect(d.rows[0]).toMatchObject({ clientName: 'New Person', billed: 45 })
    expect(d.rows[0].flags.map((f) => f.kind)).toEqual(['unmatched', 'no-status', 'not-paid'])
  })

  it('adds people who paid without being on the schedule', () => {
    const d = buildDayDraft(
      inputs({ cash: [cash({ client_id: 'rami', debit: 45 }), cash({ name_raw: 'mystery payer', debit: 45 })] }),
    )
    expect(d.rows.map((r) => [r.clientName, r.status, r.collected, r.flags.map((f) => f.kind)])).toEqual([
      ['Rami Testa', 'walk-in', 45, ['paid-not-scheduled']],
      ['Mystery Payer', 'walk-in', 45, ['paid-not-scheduled', 'unmatched']],
    ])
  })

  it('counts two sessions of one client on the same package', () => {
    const d = buildDayDraft(
      inputs({ entries: [entry({ client_id: 'omar' }), entry({ client_id: 'omar', slot_time: '10:00:00' })], packages: [pkg('p1', 'omar', 8)] }),
    )
    expect(d.rows.map((r) => r.sessionNo)).toEqual([9, 10])
  })

  it('treats a package bought today as package, collected on that row', () => {
    const d = buildDayDraft(
      inputs({
        entries: [entry({ client_id: 'jane' })],
        cash: [cash({ client_id: 'jane', kind: 'package', description: 'Package of 10 POS 400$', debit: null, pos_amount: 400, method: 'pos' })],
        packages: [pkg('p9', 'jane', 0)],
      }),
    )
    expect(d.rows[0]).toMatchObject({ billingType: 'package', collected: 400, paymentMethod: 'pos', sessionNo: 1 })
  })

  it('asks to accept a proposed package first', () => {
    const d = buildDayDraft(inputs({ entries: [entry({ client_id: 'jane', billing_note: 'package' })], packages: [pkg('p2', 'jane', 0, 10, 'proposed')] }))
    expect(d.rows[0].flags.map((f) => f.kind)).toEqual(['package-to-review'])
  })

  it('lists expenses with learned labels and keeps insurer payments apart', () => {
    const d = buildDayDraft(
      inputs({
        cash: [
          cash({ name_raw: 'acme water', description: '5 boxes of water', kind: 'expense', debit: null, credit: 12 }),
          cash({ name_raw: 'corner shop', description: 'cleaning supplies', kind: 'expense', debit: null, credit: 8 }),
          cash({ name_raw: 'testinsure', description: 'payment', kind: 'insurer_payment', debit: 900 }),
        ],
      }),
    )
    expect(d.expenses.map((e) => [e.label, e.amount])).toEqual([
      ['Water 5 boxes', 12],
      ['Cleaning Supplies', 8],
    ])
    expect(d.insurerPayments).toMatchObject([{ amount: 900 }])
    expect(d.rows).toEqual([])
  })

  it('honours Free written on the sheet', () => {
    const d = buildDayDraft(inputs({ entries: [entry({ client_id: 'jane', billing_note: 'free' })], packages: [pkg('p1', 'jane', 1)] }))
    expect(d.rows[0]).toMatchObject({ billingType: 'free', billed: 0, packageId: null })
  })
})

describe('applyEdits and toReportData', () => {
  const draft = buildDayDraft(
    inputs({
      entries: [
        entry({ id: 'x1', client_id: 'jane', status: 'confirmed' }),
        entry({ id: 'x2', client_id: 'omar', slot_time: '08:00:00' }),
        entry({ id: 'x3', client_id: 'lina', status: 'rescheduled' }),
      ],
      packages: [{ ...pkg('p1', 'omar', 2), amount_paid: 100 }],
    }),
  )

  it('marks a row free, removes one, restores a rescheduled booking', () => {
    const { rows, excluded } = applyEdits(draft, {
      ...emptyEdits(),
      rows: { 'entry:x1': { billingType: 'free', billed: 0 } },
      restored: ['entry:x3'],
    })
    expect(rows.map((r) => [r.clientName, r.billingType, r.flags.map((f) => f.kind)])).toEqual([
      ['Omar Sample', 'package', []],
      ['Jane Testerson', 'free', []],
      ['Lina Example', 'per_session', ['not-paid']],
    ])
    expect(excluded).toEqual([])
    const removed = applyEdits(draft, { ...emptyEdits(), removed: ['entry:x2'] })
    expect(removed.rows.map((r) => r.clientName)).toEqual(['Jane Testerson'])
    expect(removed.excluded.map((r) => r.clientName)).toEqual(['Lina Example', 'Omar Sample'])
  })

  it('builds report sections in time order and counts unpaid packages', () => {
    const { rows } = applyEdits(draft, emptyEdits())
    const data = toReportData(rows, [{ label: 'Coffee', amount: 6 }], [{ ...pkg('p1', 'omar', 2), amount_paid: 100 }], '16 October 2026')
    expect(data.sections.package.map((r) => [r.client, r.sessionNo])).toEqual([['Omar Sample', 3]])
    expect(data.sections.per_session.map((r) => r.client)).toEqual(['Jane Testerson'])
    expect(data.totalClients).toBe(2)
    expect(data.packageNotPaid).toBe(1)
  })
})

describe('monthReportDays', () => {
  const session = (over: Record<string, unknown>) => ({
    id: String(Math.random()),
    owner_id: 'u',
    created_at: '',
    updated_at: '',
    client_id: 'jane',
    client_name: 'Jane Testerson',
    therapist: 'Therapist A',
    billing_type: 'per_session',
    payment_method: 'cash',
    package_id: null,
    approval_id: null,
    schedule_entry_id: null,
    cash_transaction_id: null,
    session_no: null,
    billed: 45,
    collected: 45,
    extra_note: null,
    confirmed: true,
    date: '2026-10-15',
    ...over,
  })

  it('builds one tab per confirmed day, in date order, with serials and expenses', () => {
    const days = monthReportDays({
      confirmedDates: ['2026-10-16', '2026-10-15'],
      sessions: [
        session({}),
        session({ date: '2026-10-16', client_id: 'lina', client_name: 'Lina Example', billing_type: 'insurance', approval_id: 'a1', billed: 25, collected: 5, session_no: 2 }),
        session({ date: '2026-10-16', client_id: 'omar', client_name: 'Omar Sample', billing_type: 'package', package_id: 'p1', billed: 40, collected: 0, session_no: 7 }),
      ] as never,
      expenses: [{ date: '2026-10-16', name_raw: 'acme water', description: '5 boxes of water', credit: 12, pos_amount: null }],
      labels: new Map([['acme water|5 boxes of water', 'Water 5 boxes']]),
      packages: [{ ...pkg('p1', 'omar', 6), amount_paid: 100 }],
      approvals: [approval('a1', 'lina', 1)],
    })
    expect(days.map((d) => d.sheetName)).toEqual(['Thu Oct 15', 'Fri Oct 16'])
    expect(days[1].data.sections.insurance).toMatchObject([{ client: 'Lina Example', serialNumber: 'S-1', sessionNo: 2 }])
    expect(days[1].data.expenses).toEqual([{ label: 'Water 5 boxes', amount: 12 }])
    expect(days[1].data.packageNotPaid).toBe(1)
    expect(days[0].data.totalClients).toBe(1)
  })
})

describe('days already covered by "sessions already used"', () => {
  it('bills the package but takes the session number from the sheet and flags nothing', () => {
    const covered = { ...pkg('p1', 'omar', 10), used_before_app_as_of: '2026-10-14' }
    const past = buildDayDraft(inputs({ date: '2026-10-09', entries: [entry({ client_id: 'omar', session_no: 6 })], packages: [covered] }))
    expect(past.rows[0]).toMatchObject({ billingType: 'package', packageId: 'p1', sessionNo: 6, flags: [] })
    const after = buildDayDraft(inputs({ date: '2026-10-15', entries: [entry({ client_id: 'omar' })], packages: [covered] }))
    expect(after.rows[0].flags.map((f) => f.kind)).toEqual(['exhausted'])
  })
})
