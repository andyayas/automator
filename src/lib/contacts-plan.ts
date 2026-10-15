import type { Tables } from './database.types'
import type { ContactRow } from './contacts'
import { createNameMatcher, normalizeName } from './names'

type Client = Tables<'clients'>

export type ContactsSource = 'sheet' | 'phone'

export type ContactsPlan = {
  inserts: ContactRow[]
  /** Contacts phone refreshed (and the client linked to its Contacts entry). */
  phoneUpdates: Array<{ client: Client; phone: string | null; contactsKey?: string }>
  /** From the phone export: a newer number than the one the app has. Wins like her own fix. */
  phoneOverrides: Array<{ client: Client; phone: string }>
  /** From the phone export: another name for a client with that number. */
  aliases: Array<{ clientId: string; alias: string }>
  /** From the phone export: very close to an existing client; not added, for her to check. */
  skipped: Array<{ row: ContactRow; closest: string }>
  unchanged: number
}

/**
 * Compares contacts with the clients she already has. Never touches names she
 * edited or phone fixes she made. Clients she added by hand are matched by name
 * too, so a later import fills their phone instead of adding them twice.
 *
 * source 'sheet' (the schedule's Contacts tab): adds new contacts and refreshes
 * the Contacts phone. source 'phone' (a .vcf from the clinic phone): the
 * phone's number is the newer one, and it is careful about duplicates (same
 * number under another name, or a near-identical name, is not added again).
 */
export function planContactsImport(
  contacts: ContactRow[],
  existing: Client[],
  source: ContactsSource = 'sheet',
  /** Saved spellings (normalized alias -> client id): a contact under one of them is that client. */
  aliases: Map<string, string> = new Map(),
): ContactsPlan {
  const byKey = new Map(existing.filter((c) => c.contacts_key).map((c) => [c.contacts_key!, c]))
  const byName = new Map<string, Client>()
  for (const c of existing) {
    const n = normalizeName(c.name)
    if (!byName.has(n)) byName.set(n, c)
  }
  const byPhone = new Map(existing.filter((c) => c.phone).map((c) => [c.phone!, c]))
  const match = source === 'phone' ? createNameMatcher(existing.map((c) => ({ id: c.id, name: c.name }))) : null
  const nameOf = new Map(existing.map((c) => [c.id, c.name]))
  const byId = new Map(existing.map((c) => [c.id, c]))

  const plan: ContactsPlan = { inserts: [], phoneUpdates: [], phoneOverrides: [], aliases: [], skipped: [], unchanged: 0 }
  const linked = new Set<string>()

  for (const row of contacts) {
    const named = byName.get(row.key)
    const aliased = aliases.has(row.key) ? byId.get(aliases.get(row.key)!) : undefined
    const client = byKey.get(row.key) ?? (named && !linked.has(named.id) ? named : undefined) ?? (aliased && !linked.has(aliased.id) ? aliased : undefined)
    if (client) {
      linked.add(client.id)
      const link = client.contacts_key ? undefined : row.key
      if (row.phone && !client.phone) plan.phoneUpdates.push({ client, phone: row.phone, contactsKey: link })
      else if (row.phone && source === 'phone' && row.phone !== client.phone) plan.phoneOverrides.push({ client, phone: row.phone })
      else if (row.phone && source === 'sheet' && row.phone !== client.phone_contacts) plan.phoneUpdates.push({ client, phone: row.phone, contactsKey: link })
      else if (link) plan.phoneUpdates.push({ client, phone: client.phone_contacts, contactsKey: link })
      else plan.unchanged++
      continue
    }
    if (source === 'phone') {
      const samePhone = row.phone ? byPhone.get(row.phone) : undefined
      if (samePhone) {
        plan.aliases.push({ clientId: samePhone.id, alias: row.key })
        continue
      }
      const m = match!(row.name)
      if (m.kind === 'fuzzy') {
        plan.skipped.push({ row, closest: nameOf.get(m.id) ?? '' })
        continue
      }
    }
    plan.inserts.push(row)
  }
  return plan
}
