// Check-in messages: clients who haven't been back for a while get a "how are
// you feeling?" WhatsApp. Pure: the data comes from checkins-api.ts. Like the
// reminders, nothing is sent automatically; she presses Send in WhatsApp.

/** Her choice: a client is due a check-in 30 days after their last visit. */
export const CHECKIN_AFTER_DAYS = 30
/** Only visits from October 2026 on count (the app's data starts there). */
export const CHECKIN_VISITS_FROM = '2026-10-01'

export const DEFAULT_CHECKIN_TEMPLATE = `Hello {name},
It's been a while since your last physiotherapy session on {last_visit}. How are you feeling?
If you'd like to book a follow-up session, just reply to this message.

Kind regards,
{sender_name}`

export const CHECKIN_PLACEHOLDERS = ['{name}', '{last_visit}', '{sender_name}'] as const

export type Visit = { clientId: string; date: string; therapist?: string | null }
export type CheckinDue = { clientId: string; lastVisit: string; daysSince: number; therapist: string | null }

const DAY = 86_400_000
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)

/**
 * Who is due a check-in today: last visit (from `CHECKIN_VISITS_FROM`) at
 * least `CHECKIN_AFTER_DAYS` ago, no booking coming up, still an active
 * client, and not already messaged or skipped for that last visit.
 * Longest-gone first.
 */
export function dueCheckins(input: {
  today: string
  visits: Visit[]
  /** Client ids with a booking after today (not cancelled). */
  upcoming: Set<string>
  /** Client ids that are no longer active. */
  inactive: Set<string>
  /** "clientId|lastVisit" already sent or skipped. */
  handled: Set<string>
  afterDays?: number
  from?: string
}): CheckinDue[] {
  const after = input.afterDays ?? CHECKIN_AFTER_DAYS
  const from = input.from ?? CHECKIN_VISITS_FROM
  const last = new Map<string, Visit>()
  for (const v of input.visits) {
    if (v.date < from || v.date > input.today) continue
    const prev = last.get(v.clientId)
    if (!prev || v.date > prev.date || (v.date === prev.date && !prev.therapist && v.therapist)) last.set(v.clientId, v)
  }
  const due: CheckinDue[] = []
  for (const [clientId, v] of last) {
    const daysSince = daysBetween(v.date, input.today)
    if (daysSince < after) continue
    if (input.upcoming.has(clientId) || input.inactive.has(clientId)) continue
    if (input.handled.has(`${clientId}|${v.date}`)) continue
    due.push({ clientId, lastVisit: v.date, daysSince, therapist: v.therapist ?? null })
  }
  return due.sort((a, b) => b.daysSince - a.daysSince || a.lastVisit.localeCompare(b.lastVisit))
}

/** Fills in the check-in template. Unknown placeholders are left as typed. */
export function renderCheckin(template: string, values: { name: string; lastVisit: string; senderName: string }): string {
  const day = new Date(`${values.lastVisit}T00:00:00`)
  const replacements: Record<string, string> = {
    '{name}': values.name,
    '{last_visit}': day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
    '{sender_name}': values.senderName,
  }
  return template.replace(/\{[a-z_]+\}/g, (token) => replacements[token] ?? token)
}
