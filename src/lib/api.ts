// Data access for clients, packages and insurance approvals. Every query runs
// as the signed-in user, so RLS limits it to her own rows.

import type { Database, Tables, TablesInsert, TablesUpdate } from './database.types'
import type { ContactsPlan } from './contacts-plan'
import { supabase } from './supabase'

export type Client = Tables<'clients'>
export type ClientAlias = Tables<'client_aliases'>
export type Status = 'proposed' | 'active' | 'finished' | 'cancelled'

type Balance = {
  sessions_used_in_app: number
  sessions_used: number
  sessions_remaining: number
  last_session_on: string | null
}
export type ClientRef = { id: string; name: string; phone: string | null }
export type PackageWithBalance = Tables<'packages'> & Balance & { status: Status; client: ClientRef | null }
export type ApprovalWithBalance = Tables<'insurance_approvals'> & Balance & { status: Status; client: ClientRef | null }
export type PackageInput = Omit<TablesInsert<'packages'>, 'owner_id' | 'id' | 'created_at' | 'updated_at'>
export type ApprovalInput = Omit<TablesInsert<'insurance_approvals'>, 'owner_id' | 'id' | 'created_at' | 'updated_at'>
export type DaySession = Tables<'day_sessions'>

const PAGE = 1000
const CLIENT_COLUMNS = 'id, name, phone, phone_contacts, phone_override, contacts_key, notes, active, created_at, updated_at, owner_id'

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new Error(error.message)
}

/** All clients (PostgREST returns at most 1000 rows per request, so page through). */
export async function fetchAllClients(): Promise<Client[]> {
  const all: Client[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('clients')
      .select(CLIENT_COLUMNS)
      .order('name')
      .order('id')
      .range(from, from + PAGE - 1)
    fail(error)
    all.push(...data)
    if (data.length < PAGE) return all
  }
}

export async function fetchClient(id: string): Promise<Client> {
  const { data, error } = await supabase.from('clients').select(CLIENT_COLUMNS).eq('id', id).single()
  fail(error)
  return data
}

export async function createClientRecord(input: { name: string; phone_override?: string | null; notes?: string | null }) {
  const { data, error } = await supabase.from('clients').insert(input).select(CLIENT_COLUMNS).single()
  fail(error)
  return data
}

export async function updateClient(id: string, changes: TablesUpdate<'clients'>) {
  const { error } = await supabase.from('clients').update(changes).eq('id', id)
  fail(error)
}

export async function fetchAliases(clientId: string): Promise<ClientAlias[]> {
  const { data, error } = await supabase.from('client_aliases').select('*').eq('client_id', clientId).order('alias')
  fail(error)
  return data
}

export async function deleteAlias(id: string) {
  const { error } = await supabase.from('client_aliases').delete().eq('id', id)
  fail(error)
}

/** Saves a name variant for a client; ignores it if the variant already exists. */
export async function addAlias(clientId: string, alias: string) {
  const { error } = await supabase
    .from('client_aliases')
    .upsert({ client_id: clientId, alias }, { onConflict: 'owner_id,alias', ignoreDuplicates: true })
  fail(error)
}

// ---------------------------------------------------------------------------
// Packages and approvals (read through the balance views)
// ---------------------------------------------------------------------------

const CLIENT_EMBED = 'client:clients(id, name, phone)'

export async function fetchPackages(filter: { clientId?: string; statuses?: Status[] } = {}) {
  let query = supabase.from('package_balances').select(`*, ${CLIENT_EMBED}`)
  if (filter.clientId) query = query.eq('client_id', filter.clientId)
  if (filter.statuses) query = query.in('status', filter.statuses)
  const { data, error } = await query.order('purchased_on', { ascending: false, nullsFirst: false })
  fail(error)
  return data as unknown as PackageWithBalance[]
}

export async function fetchPackage(id: string) {
  const { data, error } = await supabase.from('package_balances').select(`*, ${CLIENT_EMBED}`).eq('id', id).single()
  fail(error)
  return data as unknown as PackageWithBalance
}

export async function savePackage(id: string | null, input: PackageInput) {
  const { error } = id
    ? await supabase.from('packages').update(input).eq('id', id)
    : await supabase.from('packages').insert(input)
  fail(error)
}

export async function deletePackage(id: string) {
  const { error } = await supabase.from('packages').delete().eq('id', id)
  if (error?.code === '23503') throw new Error('This package has confirmed sessions, so it can only be cancelled.')
  fail(error)
}

export async function fetchApprovals(filter: { clientId?: string; statuses?: Status[] } = {}) {
  let query = supabase.from('approval_balances').select(`*, ${CLIENT_EMBED}`)
  if (filter.clientId) query = query.eq('client_id', filter.clientId)
  if (filter.statuses) query = query.in('status', filter.statuses)
  const { data, error } = await query.order('approved_on', { ascending: false, nullsFirst: false })
  fail(error)
  return data as unknown as ApprovalWithBalance[]
}

export async function fetchApproval(id: string) {
  const { data, error } = await supabase.from('approval_balances').select(`*, ${CLIENT_EMBED}`).eq('id', id).single()
  fail(error)
  return data as unknown as ApprovalWithBalance
}

export async function saveApproval(id: string | null, input: ApprovalInput) {
  const { error } = id
    ? await supabase.from('insurance_approvals').update(input).eq('id', id)
    : await supabase.from('insurance_approvals').insert(input)
  fail(error)
}

export async function deleteApproval(id: string) {
  const { error } = await supabase.from('insurance_approvals').delete().eq('id', id)
  if (error?.code === '23503') throw new Error('This approval has confirmed sessions, so it can only be cancelled.')
  fail(error)
}

export async function setStatus(kind: 'package' | 'approval', id: string, status: Status) {
  const table = kind === 'package' ? 'packages' : 'insurance_approvals'
  const { error } = await supabase.from(table).update({ status }).eq('id', id)
  fail(error)
}

export async function fetchInsurers(): Promise<string[]> {
  const { data, error } = await supabase.from('insurance_approvals').select('insurer')
  fail(error)
  return [...new Set(data.map((r) => r.insurer.trim()))].sort((a, b) => a.localeCompare(b))
}

export async function fetchClientSessions(clientId: string): Promise<DaySession[]> {
  const { data, error } = await supabase
    .from('day_sessions')
    .select('*')
    .eq('client_id', clientId)
    .eq('confirmed', true)
    .order('date', { ascending: false })
  fail(error)
  return data
}

// ---------------------------------------------------------------------------
// Contacts import
// ---------------------------------------------------------------------------

export async function applyContactsImport(plan: ContactsPlan, onProgress?: (done: number, total: number) => void) {
  const total = plan.inserts.length + plan.phoneUpdates.length
  let done = 0
  const chunk = 500
  for (let i = 0; i < plan.inserts.length; i += chunk) {
    const rows = plan.inserts
      .slice(i, i + chunk)
      .map((c) => ({ name: c.name, contacts_key: c.key, phone_contacts: c.phone }))
    const { error } = await supabase
      .from('clients')
      .upsert(rows, { onConflict: 'owner_id,contacts_key', ignoreDuplicates: true })
    fail(error)
    done += rows.length
    onProgress?.(done, total)
  }
  for (let i = 0; i < plan.phoneUpdates.length; i += chunk) {
    // Upsert needs the NOT NULL columns, so send the client's current name back unchanged.
    const rows = plan.phoneUpdates
      .slice(i, i + chunk)
      .map(({ client, phone }) => ({ id: client.id, name: client.name, contacts_key: client.contacts_key, phone_contacts: phone }))
    const { error } = await supabase.from('clients').upsert(rows, { onConflict: 'id' })
    fail(error)
    done += rows.length
    onProgress?.(done, total)
  }
}

export type { Database }
