// Data access for the schedule, reminders and settings (all as the signed-in
// user, so RLS limits everything to her rows).

import type { Json, Tables } from './database.types'
import { DEFAULT_EXPENSE_LABELS, DEFAULT_NON_CLIENT_PATTERNS, SETTING } from './defaults'
import type { NonClientPattern } from './schedule-cell'
import type { ScheduleImportPlan } from './schedule-import'
import { storedKey } from './schedule-import'
import { supabase } from './supabase'

export type ScheduleEntry = Tables<'schedule_entries'> & { client: { id: string; name: string; phone: string | null } | null }
export type Reminder = Tables<'reminders'>
export type PatternRow = Tables<'non_client_patterns'>

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export async function fetchScheduleDay(date: string): Promise<ScheduleEntry[]> {
  const { data, error } = await supabase
    .from('schedule_entries')
    .select('*, client:clients(id, name, phone)')
    .eq('date', date)
    .order('slot_time')
    .order('therapist')
  fail(error)
  return data as unknown as ScheduleEntry[]
}

/** When the schedule for this date was last refreshed. */
export async function fetchScheduleImportTime(importId: string): Promise<string | null> {
  const { data, error } = await supabase.from('imports').select('imported_at').eq('id', importId).maybeSingle()
  fail(error)
  return data?.imported_at ?? null
}

export async function fetchAllAliases(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('client_aliases').select('alias, client_id').range(from, from + 999)
    fail(error)
    for (const a of data) map.set(a.alias, a.client_id)
    if (data.length < 1000) return map
  }
}

export async function fetchConfirmedDates(dates: string[]): Promise<Set<string>> {
  if (!dates.length) return new Set()
  const { data, error } = await supabase.from('day_reviews').select('date').in('date', dates).not('confirmed_at', 'is', null)
  fail(error)
  return new Set(data.map((d) => d.date))
}

export async function fetchStoredBookings(dates: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (!dates.length) return map
  const { data, error } = await supabase.from('schedule_entries').select('date, slot_time, therapist, raw_text').in('date', dates)
  fail(error)
  for (const e of data) map.set(e.date, [...(map.get(e.date) ?? []), storedKey(e)])
  return map
}

/** Replaces each day's entries (never a confirmed day; the plan already excludes those). */
export async function applyScheduleImport(plan: ScheduleImportPlan, source: string) {
  const dates = [...plan.replace.keys()]
  const rows = [...plan.replace.values()].flat()
  const { data: imp, error: impError } = await supabase
    .from('imports')
    .insert({
      kind: 'schedule',
      filename: source,
      rows_added: rows.length,
      details: {
        dates,
        unmatched: plan.unmatched,
        uncertain: plan.uncertain,
        confirmed_days_changed: plan.confirmedChanged,
      } as unknown as Json,
    })
    .select('id')
    .single()
  fail(impError)

  for (let i = 0; i < dates.length; i += 100) {
    const { error } = await supabase.from('schedule_entries').delete().in('date', dates.slice(i, i + 100))
    fail(error)
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('schedule_entries').insert(rows.slice(i, i + 500).map((r) => ({ ...r, import_id: imp.id })))
    fail(error)
  }
  return imp.id
}

/**
 * She confirmed that a name on the schedule is this client: remember the
 * spelling and link every booking with it.
 */
export async function linkNameToClient(nameKey: string, clientId: string) {
  const { error: aliasError } = await supabase
    .from('client_aliases')
    .upsert({ client_id: clientId, alias: nameKey }, { onConflict: 'owner_id,alias' })
  fail(aliasError)
  const { error } = await supabase.from('schedule_entries').update({ client_id: clientId, match_kind: 'alias' }).eq('name_key', nameKey)
  fail(error)
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

export async function fetchReminders(date: string): Promise<Reminder[]> {
  const { data, error } = await supabase.from('reminders').select('*').eq('date', date)
  fail(error)
  return data
}

export async function markReminderSent(r: { date: string; slot_time: string; therapist: string; client_id: string; phone_used: string }) {
  const { error } = await supabase
    .from('reminders')
    .upsert({ ...r, sent_at: new Date().toISOString() }, { onConflict: 'owner_id,date,slot_time,client_id' })
  fail(error)
}

export async function markReminderUnsent(id: string) {
  const { error } = await supabase.from('reminders').update({ sent_at: null }).eq('id', id)
  fail(error)
}

// ---------------------------------------------------------------------------
// Settings and non-client patterns
// ---------------------------------------------------------------------------

export async function fetchSettings(): Promise<Record<string, Json>> {
  const { data, error } = await supabase.from('settings').select('key, value')
  fail(error)
  return Object.fromEntries(data.map((s) => [s.key, s.value]))
}

export async function saveSetting(key: string, value: Json) {
  const { error } = await supabase.from('settings').upsert({ key, value }, { onConflict: 'owner_id,key' })
  fail(error)
}

export async function fetchPatterns(): Promise<PatternRow[]> {
  const { data, error } = await supabase.from('non_client_patterns').select('*').order('match_type').order('pattern')
  fail(error)
  return data
}

export async function addPattern(p: NonClientPattern) {
  const { error } = await supabase.from('non_client_patterns').insert(p)
  if (error?.code === '23505') throw new Error('That entry is already in the list.')
  fail(error)
}

export async function deletePattern(id: string) {
  const { error } = await supabase.from('non_client_patterns').delete().eq('id', id)
  fail(error)
}

/** Copies the default lists into her account once. Safe to call repeatedly. */
export async function ensureDefaults() {
  const settings = await fetchSettings()
  if (settings[SETTING.defaultsSeeded]) return
  const { error: pErr } = await supabase
    .from('non_client_patterns')
    .upsert(DEFAULT_NON_CLIENT_PATTERNS, { onConflict: 'owner_id,match_type,pattern', ignoreDuplicates: true })
  fail(pErr)
  const { error: eErr } = await supabase
    .from('expense_labels')
    .upsert(
      Object.entries(DEFAULT_EXPENSE_LABELS).map(([match_key, label]) => ({ match_key, label })),
      { onConflict: 'owner_id,match_key', ignoreDuplicates: true },
    )
  fail(eErr)
  await saveSetting(SETTING.defaultsSeeded, true)
}
