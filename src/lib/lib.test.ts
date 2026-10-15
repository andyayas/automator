// Synthetic names only.
import { describe, expect, it } from 'vitest'
import { utils } from 'xlsx'
import { parseContacts } from './contacts'
import { createNameMatcher, displayName, normalizeName, tokenSortRatio } from './names'
import { formatPhone, normalizePhone } from './phone'

describe('normalizeName', () => {
  it('trims, lowercases, collapses spaces and strips accents and punctuation', () => {
    expect(normalizeName('  Zélie   O’Brien-Testa ')).toBe('zelie obrien testa')
    expect(normalizeName(null)).toBe('')
  })
})

describe('displayName', () => {
  it('title-cases names typed in one case and keeps mixed case', () => {
    expect(displayName('jane  doe')).toBe('Jane Doe')
    expect(displayName('JANE DOE')).toBe('Jane Doe')
    expect(displayName('Jane McDoe')).toBe('Jane McDoe')
  })
})

describe('tokenSortRatio', () => {
  it('ignores word order and small typos', () => {
    expect(tokenSortRatio('Doe Jane', 'jane doe')).toBe(1)
    expect(tokenSortRatio('Jane Doee', 'Jane Doe')).toBeGreaterThan(0.85)
    expect(tokenSortRatio('Jane Doe', 'John Smith')).toBeLessThan(0.5)
  })
})

describe('createNameMatcher', () => {
  const clients = [
    { id: 'c1', name: 'Jane Testerson' },
    { id: 'c2', name: 'Omar Example' },
    { id: 'c3', name: 'Lina Sample' },
  ]
  const match = createNameMatcher(clients, new Map([['jt', 'c1']]))

  it('prefers aliases, then exact names', () => {
    expect(match('JT')).toEqual({ kind: 'alias', id: 'c1', score: 1 })
    expect(match('omar  example ')).toEqual({ kind: 'exact', id: 'c2', score: 1 })
  })

  it('falls back to fuzzy matching above the threshold', () => {
    const m = match('Jane Testersen')
    expect(m.kind).toBe('fuzzy')
    expect(m.kind === 'fuzzy' && m.id).toBe('c1')
  })

  it('reports no match below the threshold', () => {
    expect(match('Completely Different').kind).toBe('none')
    expect(match('').kind).toBe('none')
  })

  it('flags ambiguous fuzzy matches', () => {
    const twins = createNameMatcher([
      { id: 'a', name: 'Rami Testa' },
      { id: 'b', name: 'Rima Testa' },
    ])
    const m = twins('Rama Testa')
    expect(m.kind).toBe('fuzzy')
    expect(m.kind === 'fuzzy' && m.ambiguousWith).toBeTruthy()
  })
})

describe('normalizePhone', () => {
  it('reads numbers stored as floats', () => {
    expect(normalizePhone(9613001272.0)).toBe('9613001272')
    expect(normalizePhone('96171123456.0')).toBe('96171123456')
  })

  it('keeps foreign numbers as they are', () => {
    expect(normalizePhone(971501234567)).toBe('971501234567')
    expect(normalizePhone('+44 7700 900123')).toBe('447700900123')
    expect(normalizePhone('0044 7700 900123')).toBe('447700900123')
  })

  it('adds 961 to short local numbers only', () => {
    expect(normalizePhone('03 123 456')).toBe('9613123456')
    expect(normalizePhone('71123456')).toBe('96171123456')
    expect(normalizePhone('3123456')).toBe('9613123456')
  })

  it('rejects things that are not phone numbers', () => {
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone('ask reception')).toBeNull()
    expect(normalizePhone('12345')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
  })

  it('formats for display', () => {
    expect(formatPhone('96171123456')).toBe('+961 71 123 456')
    expect(formatPhone('9613123456')).toBe('+961 3 123 456')
    expect(formatPhone('447700900123')).toBe('+447700900123')
  })
})

describe('parseContacts', () => {
  function workbook(rows: unknown[][], tab = 'Contacts') {
    const wb = utils.book_new()
    utils.book_append_sheet(wb, utils.aoa_to_sheet([['Day'], ['x']]), 'Tue 1 SEP')
    utils.book_append_sheet(wb, utils.aoa_to_sheet(rows), tab)
    return wb
  }

  it('reads names and phones, skipping blanks and merging duplicates', () => {
    const result = parseContacts(
      workbook([
        ['Name', 'Phone'],
        ['jane testerson', 9613001272.0],
        [null, null],
        ['Omar Example', 'n/a'],
        ['JANE  TESTERSON', 96171000000],
        ['Lina Sample', null],
      ]),
    )
    expect(result.contacts).toEqual([
      { key: 'jane testerson', name: 'Jane Testerson', phone: '9613001272' },
      { key: 'omar example', name: 'Omar Example', phone: null },
      { key: 'lina sample', name: 'Lina Sample', phone: null },
    ])
    expect(result.duplicates).toBe(1)
    expect(result.invalidPhones).toBe(1)
  })

  it('explains a file without a Contacts tab', () => {
    expect(() => parseContacts(workbook([['a']], 'Other'))).toThrow(/Contacts/)
  })
})
