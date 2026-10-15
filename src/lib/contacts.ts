import { displayName, normalizeName } from './names'
import { normalizePhone } from './phone'

export type ContactRow = {
  /** Normalized name, used as clients.contacts_key. */
  key: string
  name: string
  phone: string | null
}

export type ContactsParseResult = {
  contacts: ContactRow[]
  /** Rows whose name appeared earlier in the tab (merged into the first). */
  duplicates: number
  /** Rows with a phone value that isn't a usable number. */
  invalidPhones: number
}

/** Reads Contacts rows (column A name, column B phone), from a file or the live sheet. */
export function parseContactsRows(rows: unknown[][]): ContactsParseResult {
  const byKey = new Map<string, ContactRow>()
  let duplicates = 0
  let invalidPhones = 0
  rows.forEach((row, index) => {
    const [rawName, rawPhone] = row
    if (index === 0 && normalizeName(rawName) === 'name') return
    const key = normalizeName(rawName)
    if (!key) return
    const phone = normalizePhone(rawPhone)
    if (phone === null && rawPhone !== null && rawPhone !== undefined && String(rawPhone).trim() !== '') invalidPhones++

    const existing = byKey.get(key)
    if (existing) {
      duplicates++
      if (!existing.phone && phone) existing.phone = phone
      return
    }
    byKey.set(key, { key, name: displayName(String(rawName)), phone })
  })

  return { contacts: [...byKey.values()], duplicates, invalidPhones }
}
