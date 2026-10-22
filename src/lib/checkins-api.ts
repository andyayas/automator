// Data for the check-in list: visits since October, upcoming bookings, and the
// check-ins she already sent or skipped.
import { CHECKIN_VISITS_FROM, dueCheckins, type CheckinDue, type Visit } from './checkins'
import { supabase } from './supabase'

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new Error(error.message)
}

async function allRows<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999)
    fail(error)
    out.push(...(data ?? []))
    if ((data ?? []).length < 1000) return out
  }
}

export type CheckinRow = CheckinDue & { name: string; phone: string | null }

/** Who to check in on today, with their name and phone. */
export async function fetchCheckinsDue(today: string): Promise<CheckinRow[]> {
  const [sessions, booked, upcoming, clients, handled] = await Promise.all([
    // Confirmed days in the review.
    allRows<{ client_id: string | null; date: string; therapist: string | null }>((a, b) =>
      supabase.from('day_sessions').select('client_id, date, therapist').eq('confirmed', true).gte('date', CHECKIN_VISITS_FROM).lte('date', today).range(a, b),
    ),
    // "C" bookings on the sheet, for days not reviewed yet.
    allRows<{ client_id: string | null; date: string; therapist: string | null }>((a, b) =>
      supabase
        .from('schedule_entries')
        .select('client_id, date, therapist')
        .eq('status', 'confirmed')
        .eq('is_non_client', false)
        .not('client_id', 'is', null)
        .gte('date', CHECKIN_VISITS_FROM)
        .lte('date', today)
        .range(a, b),
    ),
    allRows<{ client_id: string | null }>((a, b) =>
      supabase.from('schedule_entries').select('client_id').gt('date', today).neq('status', 'cancelled').not('client_id', 'is', null).range(a, b),
    ),
    allRows<{ id: string; name: string; phone: string | null; active: boolean }>((a, b) => supabase.from('clients').select('id, name, phone, active').range(a, b)),
    allRows<{ client_id: string; last_visit: string }>((a, b) => supabase.from('checkins').select('client_id, last_visit').range(a, b)),
  ])
  const visits: Visit[] = [...sessions, ...booked]
    .filter((v): v is { client_id: string; date: string; therapist: string | null } => Boolean(v.client_id))
    .map((v) => ({ clientId: v.client_id, date: v.date, therapist: v.therapist }))
  const byId = new Map(clients.map((c) => [c.id, c]))
  return dueCheckins({
    today,
    visits,
    upcoming: new Set(upcoming.map((u) => u.client_id!)),
    inactive: new Set(clients.filter((c) => !c.active).map((c) => c.id)),
    handled: new Set(handled.map((h) => `${h.client_id}|${h.last_visit}`)),
  })
    .filter((d) => byId.has(d.clientId))
    .map((d) => ({ ...d, name: byId.get(d.clientId)!.name, phone: byId.get(d.clientId)!.phone }))
}

/** She sent (or skipped) the check-in for this last visit. */
export async function markCheckin(clientId: string, lastVisit: string, status: 'sent' | 'skipped', phone: string | null) {
  const { error } = await supabase
    .from('checkins')
    .upsert(
      { client_id: clientId, last_visit: lastVisit, status, phone_used: phone, sent_at: status === 'sent' ? new Date().toISOString() : null },
      { onConflict: 'owner_id,client_id,last_visit' },
    )
  fail(error)
}
