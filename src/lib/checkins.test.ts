// Synthetic clients only.
import { describe, expect, it } from 'vitest'
import { DEFAULT_CHECKIN_TEMPLATE, dueCheckins, renderCheckin } from './checkins'

const base = { today: '2026-11-20', upcoming: new Set<string>(), inactive: new Set<string>(), handled: new Set<string>() }

describe('dueCheckins', () => {
  it('lists clients whose last visit is 30+ days ago, longest-gone first', () => {
    const due = dueCheckins({
      ...base,
      visits: [
        { clientId: 'jane', date: '2026-10-05', therapist: 'Therapist A' },
        { clientId: 'jane', date: '2026-10-12', therapist: 'Therapist A' }, // last visit: 39 days
        { clientId: 'omar', date: '2026-10-02' }, // 49 days
        { clientId: 'lina', date: '2026-11-01' }, // 19 days: not yet
      ],
    })
    expect(due.map((d) => [d.clientId, d.lastVisit, d.daysSince])).toEqual([
      ['omar', '2026-10-02', 49],
      ['jane', '2026-10-12', 39],
    ])
    expect(due[1].therapist).toBe('Therapist A')
  })

  it('skips clients booked again, inactive ones, and ones already messaged for that visit', () => {
    const visits = [
      { clientId: 'jane', date: '2026-10-10' },
      { clientId: 'omar', date: '2026-10-10' },
      { clientId: 'lina', date: '2026-10-10' },
      { clientId: 'rami', date: '2026-10-10' },
    ]
    const due = dueCheckins({
      ...base,
      visits,
      upcoming: new Set(['jane']),
      inactive: new Set(['omar']),
      handled: new Set(['lina|2026-10-10']),
    })
    expect(due.map((d) => d.clientId)).toEqual(['rami'])
  })

  it('comes back after a new visit, and ignores visits before October', () => {
    const due = dueCheckins({
      ...base,
      visits: [
        { clientId: 'jane', date: '2026-09-01' },
        { clientId: 'omar', date: '2026-10-01' },
        { clientId: 'omar', date: '2026-10-15' },
      ],
      handled: new Set(['omar|2026-10-01']),
    })
    expect(due.map((d) => [d.clientId, d.lastVisit])).toEqual([['omar', '2026-10-15']])
  })
})

describe('renderCheckin', () => {
  it('fills in the name, the last visit and the sender', () => {
    const text = renderCheckin(DEFAULT_CHECKIN_TEMPLATE, { name: 'Jane', lastVisit: '2026-10-12', senderName: 'Test Admin' })
    expect(text).toContain('Hello Jane,')
    expect(text).toContain('on Monday 12 October')
    expect(text.endsWith('Test Admin')).toBe(true)
  })
})
