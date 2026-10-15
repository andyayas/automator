import type { Tables } from './database.types'
import type { ContactRow } from './contacts'

type Client = Tables<'clients'>

export type ContactsPlan = {
  inserts: ContactRow[]
  phoneUpdates: Array<{ client: Client; phone: string | null }>
  unchanged: number
}

/**
 * Compares Contacts rows with existing clients by contacts_key. Only the
 * Contacts phone is refreshed on existing clients: names she edited and phone
 * fixes she made (phone_override) are never touched.
 */
export function planContactsImport(contacts: ContactRow[], existing: Client[]): ContactsPlan {
  const byKey = new Map(existing.filter((c) => c.contacts_key).map((c) => [c.contacts_key!, c]))
  const plan: ContactsPlan = { inserts: [], phoneUpdates: [], unchanged: 0 }
  for (const row of contacts) {
    const client = byKey.get(row.key)
    if (!client) plan.inserts.push(row)
    else if (row.phone && row.phone !== client.phone_contacts) plan.phoneUpdates.push({ client, phone: row.phone })
    else plan.unchanged++
  }
  return plan
}
