// Synthetic data only.
import { describe, expect, it } from 'vitest'
import { balanceAlerts } from './alerts'
import type { ApprovalWithBalance, Client, PackageWithBalance } from './api'
import { planContactsImport } from './contacts-plan'
import { daysBetween, formatMoney, parseNumber, perSessionValue } from './format'
import { searchClients } from './search'

const base = {
  owner_id: 'u',
  created_at: '',
  updated_at: '',
  notes: null,
  sessions_used_before_app: 0,
  used_before_app_as_of: null,
  sessions_used_in_app: 0,
  sessions_used: 0,
  last_session_on: null,
  client: { id: 'c1', name: 'Jane Testerson', phone: null },
  client_id: 'c1',
}

function pkg(id: string, remaining: number, status: PackageWithBalance['status'] = 'active'): PackageWithBalance {
  return {
    ...base,
    id,
    status,
    sessions_total: 12,
    sessions_remaining: remaining,
    price_total: 450,
    per_session: 38,
    purchased_on: '2026-09-01',
    source_voucher: null,
  }
}

function approval(id: string, remaining: number, validUntil: string | null): ApprovalWithBalance {
  return {
    ...base,
    id,
    status: 'active',
    insurer: 'Test Insurer',
    serial_number: null,
    sessions_approved: 10,
    sessions_remaining: remaining,
    billed_per_session: 25,
    copay_per_session: 5,
    approved_on: '2026-09-01',
    valid_until: validUntil,
  }
}

describe('balanceAlerts', () => {
  const today = '2026-10-15'

  it('flags no sessions left, last session, expired and expiring', () => {
    const alerts = balanceAlerts(
      [pkg('p0', 0), pkg('p1', 1), pkg('p5', 5), pkg('prop', 0, 'proposed')],
      [approval('a-exp', 4, '2026-10-10'), approval('a-soon', 4, '2026-10-20'), approval('a-ok', 4, '2026-12-01'), approval('a-over', -1, null)],
      today,
    )
    expect(alerts.map((a) => [a.kind, a.item.value.id, a.message])).toEqual([
      ['no-sessions', 'p0', 'No sessions left'],
      ['no-sessions', 'a-over', '1 session over'],
      ['expired', 'a-exp', 'Expired 10 Oct'],
      ['last-session', 'p1', 'Last session left'],
      ['expiring', 'a-soon', 'Expires in 5 days'],
    ])
  })

  it('ignores proposed, finished and cancelled items', () => {
    expect(balanceAlerts([pkg('f', 0, 'finished'), pkg('c', 0, 'cancelled'), pkg('p', 0, 'proposed')], [], today)).toEqual([])
  })
})

describe('searchClients', () => {
  const clients = [
    { id: '1', name: 'Jane Testerson', phone: '96171000001' },
    { id: '2', name: 'Janet Example', phone: '96171000002' },
    { id: '3', name: 'Omar Sample', phone: '9613000003' },
  ]

  it('matches word prefixes in any order', () => {
    expect(searchClients(clients, 'tes jan').results.map((c) => c.id)).toEqual(['1'])
    expect(searchClients(clients, 'jan').results.map((c) => c.id)).toEqual(['1', '2'])
  })

  it('puts clients with something active first', () => {
    expect(searchClients(clients, 'jan', new Set(['2'])).results.map((c) => c.id)).toEqual(['2', '1'])
  })

  it('searches phones by digits', () => {
    expect(searchClients(clients, '3000').results.map((c) => c.id)).toEqual(['3'])
  })

  it('suggests close spellings when nothing matches', () => {
    const r = searchClients(clients, 'Omer Sampel')
    expect(r.fuzzy).toBe(true)
    expect(r.results.map((c) => c.id)).toEqual(['3'])
  })

  it('returns nothing for an empty query', () => {
    expect(searchClients(clients, '  ').results).toEqual([])
  })
})

describe('planContactsImport', () => {
  const existing = [
    { id: 'a', name: 'Renamed By Her', contacts_key: 'jane testerson', phone_contacts: '96171000001', phone_override: '96170999999' },
    { id: 'b', name: 'Omar Sample', contacts_key: 'omar sample', phone_contacts: '9613000003', phone_override: null },
    { id: 'c', name: 'Manual Client', contacts_key: null, phone_contacts: null, phone_override: null },
  ] as Client[]

  it('adds new contacts and refreshes only the Contacts phone of existing ones', () => {
    const plan = planContactsImport(
      [
        { key: 'jane testerson', name: 'Jane Testerson', phone: '96171000009' },
        { key: 'omar sample', name: 'Omar Sample', phone: '9613000003' },
        { key: 'new person', name: 'New Person', phone: null },
      ],
      existing,
    )
    expect(plan.inserts.map((c) => c.key)).toEqual(['new person'])
    expect(plan.phoneUpdates).toEqual([{ client: existing[0], phone: '96171000009' }])
    expect(plan.unchanged).toBe(1)
  })

  it('never clears a phone when the Contacts row has none', () => {
    const plan = planContactsImport([{ key: 'omar sample', name: 'Omar Sample', phone: null }], existing)
    expect(plan.phoneUpdates).toEqual([])
    expect(plan.unchanged).toBe(1)
  })
})

describe('format helpers', () => {
  it('works out the package value per session', () => {
    expect(perSessionValue(450, 12)).toBe(38)
    expect(perSessionValue(400, 10)).toBe(40)
    expect(perSessionValue(null, 12)).toBeNull()
    expect(perSessionValue(450, null)).toBeNull()
  })

  it('parses numbers typed on a phone', () => {
    expect(parseNumber('37,5')).toBe(37.5)
    expect(parseNumber(' $450 ')).toBe(450)
    expect(parseNumber('')).toBeNull()
  })

  it('formats money and day spans', () => {
    expect(formatMoney(450)).toBe('$450')
    expect(formatMoney(37.5)).toBe('$37.50')
    expect(daysBetween('2026-10-15', '2026-10-20')).toBe(5)
    expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3)
  })
})
