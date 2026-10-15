// Reads a phone's contacts export (.vcf, vCard 2.1 or 3.0, e.g. from Samsung
// or iPhone) into the same rows as the Contacts tab: name + one phone, the
// mobile one when a contact has several.

import type { ContactRow } from './contacts'
import { displayName, normalizeName } from './names'
import { normalizePhone } from './phone'

/** Decodes quoted-printable UTF-8 (used by vCard 2.1 for non-ASCII names). */
function quotedPrintable(value: string): string {
  const bytes: number[] = []
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '=' && /^[0-9A-F]{2}$/i.test(value.slice(i + 1, i + 3))) {
      bytes.push(parseInt(value.slice(i + 1, i + 3), 16))
      i += 2
    } else bytes.push(value.charCodeAt(i))
  }
  return new TextDecoder().decode(Uint8Array.from(bytes))
}

export function parseVcard(text: string): { contacts: ContactRow[]; duplicates: number; withoutPhone: number } {
  const byKey = new Map<string, ContactRow>()
  let duplicates = 0
  let withoutPhone = 0
  for (const card of text.split(/BEGIN:VCARD/i).slice(1)) {
    // Unfold continuation lines (RFC folding and quoted-printable soft breaks).
    const lines = card.replace(/=\r?\n/g, '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
    const value = (line: string) => {
      const colon = line.indexOf(':')
      const params = line.slice(0, colon)
      const raw = line.slice(colon + 1)
      return /QUOTED-PRINTABLE/i.test(params) ? quotedPrintable(raw) : raw
    }
    const fn = lines.find((l) => /^FN[;:]/i.test(l))
    const n = lines.find((l) => /^N[;:]/i.test(l))
    const name = (fn ? value(fn) : n ? value(n).split(';').filter(Boolean).reverse().join(' ') : '').replace(/\\,/g, ',').trim()
    const key = normalizeName(name)
    if (!key) continue

    const phones = lines
      .filter((l) => /^TEL[;:]/i.test(l))
      .map((l) => ({ mobile: /CELL|MOBILE/i.test(l.slice(0, l.indexOf(':'))), phone: normalizePhone(value(l)) }))
      .filter((p): p is { mobile: boolean; phone: string } => Boolean(p.phone))
    const phone = (phones.find((p) => p.mobile) ?? phones[0])?.phone ?? null
    if (!phone) withoutPhone++

    const existing = byKey.get(key)
    if (existing) {
      duplicates++
      if (!existing.phone && phone) existing.phone = phone
      continue
    }
    byKey.set(key, { key, name: displayName(name), phone })
  }
  return { contacts: [...byKey.values()], duplicates, withoutPhone }
}
