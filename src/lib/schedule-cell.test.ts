// Synthetic names only.
import { describe, expect, it } from 'vitest'
import { parseScheduleCell, type ParsedBooking } from './schedule-cell'

const one = (raw: string): ParsedBooking => {
  const cell = parseScheduleCell(raw)
  if (cell.kind !== 'bookings') throw new Error(`expected a booking, got ${cell.kind}`)
  expect(cell.bookings).toHaveLength(1)
  return cell.bookings[0]
}

describe('parseScheduleCell', () => {
  it('reads the status letter in any case', () => {
    expect(one('Jane Testerson C')).toMatchObject({ name: 'Jane Testerson', status: 'confirmed' })
    expect(one('jane testerson c')).toMatchObject({ name: 'jane testerson', status: 'confirmed' })
    expect(one('Jane Testerson X')).toMatchObject({ status: 'cancelled' })
    expect(one('Jane Testerson R')).toMatchObject({ status: 'rescheduled' })
    expect(one('Jane Testerson')).toMatchObject({ status: 'unknown', sessionNo: null })
  })

  it('reads session numbers in every order', () => {
    for (const raw of ['Jane Testerson 11 C', 'Jane Testerson C 11', 'Jane Testerson C11', 'Jane Testerson 11C', 'Jane Testerson 11c']) {
      expect(one(raw)).toMatchObject({ name: 'Jane Testerson', status: 'confirmed', sessionNo: 11 })
    }
  })

  it('handles a status glued to the name', () => {
    expect(one('Jane TestersonC')).toMatchObject({ name: 'Jane Testerson', status: 'confirmed' })
    expect(one('Jane TestersonC3')).toMatchObject({ name: 'Jane Testerson', status: 'confirmed', sessionNo: 3 })
  })

  it('keeps a lowercase c that is part of a name', () => {
    expect(one('Marc Sampleman')).toMatchObject({ name: 'Marc Sampleman', status: 'unknown' })
  })

  it('reads inline amounts and billing notes', () => {
    expect(one('Jane Testerson 45$')).toMatchObject({ name: 'Jane Testerson', amount: 45, status: 'unknown' })
    expect(one('Jane Testerson C 45$')).toMatchObject({ amount: 45, status: 'confirmed' })
    expect(one('Jane Testerson Insurance C')).toMatchObject({ billingNote: 'insurance', status: 'confirmed' })
    expect(one('Jane Testerson Free')).toMatchObject({ billingNote: 'free' })
  })

  it('splits two clients in one slot', () => {
    const cell = parseScheduleCell('Jane Testerson C / Omar Sample X')
    expect(cell).toEqual({
      kind: 'bookings',
      bookings: [
        { name: 'Jane Testerson', status: 'confirmed', sessionNo: null, amount: null, billingNote: null },
        { name: 'Omar Sample', status: 'cancelled', sessionNo: null, amount: null, billingNote: null },
      ],
    })
    const shared = parseScheduleCell('Jane Testerson / Omar Sample C')
    expect(shared.kind === 'bookings' && shared.bookings.map((b) => b.status)).toEqual(['confirmed', 'confirmed'])
  })

  it('recognises non-client entries', () => {
    for (const raw of ['Meeting', 'OFF', ' lunch ', 'x', '-', 'Labneh Time', 'Meeting with supplier', 'Outdoor session', 'InBody test', 'Staff training']) {
      expect(parseScheduleCell(raw).kind).toBe('non-client')
    }
    expect(parseScheduleCell('Dana Staffer', undefined, ['dana staffer']).kind).toBe('non-client')
  })

  it('treats blank cells as empty', () => {
    expect(parseScheduleCell(null)).toEqual({ kind: 'empty' })
    expect(parseScheduleCell('   ')).toEqual({ kind: 'empty' })
  })
})
