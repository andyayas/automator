// @vitest-environment node
// Runs the real data layer against the live project as RLS test user A.
// Local only:  npm run test:integration   (needs RLS_TEST_A_* in .env.local)
// Synthetic, tagged rows only; everything created is deleted at the end.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as api from './api'
import { planContactsImport } from './contacts-plan'
import { supabase } from './supabase'

const TAG = `itest-${Date.now()}`
const env = import.meta.env as unknown as Record<string, string | undefined>

beforeAll(async () => {
  const { error } = await supabase.auth.signInWithPassword({
    email: env.RLS_TEST_A_EMAIL!,
    password: env.RLS_TEST_A_PASSWORD!,
  })
  if (error) throw error
})

afterAll(async () => {
  const { data } = await supabase.from('clients').select('id').like('name', `${TAG}%`)
  const ids = (data ?? []).map((c) => c.id)
  if (ids.length) {
    await supabase.from('packages').delete().in('client_id', ids)
    await supabase.from('insurance_approvals').delete().in('client_id', ids)
    await supabase.from('clients').delete().in('id', ids)
  }
  await supabase.auth.signOut()
})

describe('contacts import', () => {
  it('adds new clients, then only refreshes the Contacts phone', async () => {
    const contacts = Array.from({ length: 3 }, (_, i) => ({
      key: `${TAG} person ${i}`,
      name: `${TAG} Person ${i}`,
      phone: `9617100000${i}`,
    }))
    const first = planContactsImport(contacts, await api.fetchAllClients())
    expect(first.inserts).toHaveLength(3)
    await api.applyContactsImport(first)

    let mine = (await api.fetchAllClients()).filter((c) => c.name.startsWith(TAG))
    expect(mine).toHaveLength(3)

    // She fixes one phone and renames another; a re-import must keep both.
    await api.updateClient(mine[0].id, { phone_override: '96170999999' })
    await api.updateClient(mine[1].id, { name: `${TAG} Renamed` })

    const changed = contacts.map((c, i) => (i === 0 || i === 1 ? { ...c, phone: `9617655555${i}` } : c))
    const second = planContactsImport(changed, await api.fetchAllClients())
    expect(second.inserts).toHaveLength(0)
    expect(second.phoneUpdates).toHaveLength(2)
    expect(second.unchanged).toBe(1)
    await api.applyContactsImport(second)

    mine = (await api.fetchAllClients()).filter((c) => c.name.startsWith(TAG))
    const byKey = new Map(mine.map((c) => [c.contacts_key, c]))
    const p0 = byKey.get(`${TAG} person 0`)!
    const p1 = byKey.get(`${TAG} person 1`)!
    expect(p0.phone_contacts).toBe('96176555550')
    expect(p0.phone).toBe('96170999999') // her fix still wins
    expect(p1.name).toBe(`${TAG} Renamed`) // her rename is kept
    expect(p1.phone).toBe('96176555551')
  })
})

describe('packages, approvals and aliases', () => {
  it('saves, reads balances with the client attached, and deletes', async () => {
    const client = await api.createClientRecord({ name: `${TAG} Balance Client` })

    await api.savePackage(null, {
      client_id: client.id,
      sessions_total: 12,
      price_total: 450,
      per_session: 38,
      sessions_used_before_app: 5,
      used_before_app_as_of: '2026-10-14',
      status: 'proposed',
    })
    const [pkg] = await api.fetchPackages({ clientId: client.id })
    expect(pkg).toMatchObject({ sessions_used: 5, sessions_remaining: 7, status: 'proposed' })
    expect(pkg.client).toEqual({ id: client.id, name: client.name, phone: null })

    await api.setStatus('package', pkg.id, 'active')
    expect((await api.fetchPackage(pkg.id)).status).toBe('active')

    await api.saveApproval(null, {
      client_id: client.id,
      insurer: `${TAG} Insurer`,
      sessions_approved: 10,
      billed_per_session: 25,
      copay_per_session: 5,
      status: 'active',
    })
    const [approval] = await api.fetchApprovals({ clientId: client.id })
    expect(approval).toMatchObject({ sessions_remaining: 10, status: 'active' })
    expect(await api.fetchInsurers()).toContain(`${TAG} Insurer`)

    await api.addAlias(client.id, `${TAG} alias`)
    await api.addAlias(client.id, `${TAG} alias`) // second time is a no-op
    const aliases = await api.fetchAliases(client.id)
    expect(aliases.map((a) => a.alias)).toEqual([`${TAG} alias`])
    await api.deleteAlias(aliases[0].id)
    expect(await api.fetchAliases(client.id)).toEqual([])

    await api.deletePackage(pkg.id)
    await api.deleteApproval(approval.id)
    expect(await api.fetchPackages({ clientId: client.id })).toEqual([])
  })
})
