// Which bookings get a reminder, and whether one was sent: shared by the
// Reminders page and the count on its menu tab, so both always agree.
import type { Reminder, ScheduleEntry } from './schedule-api'

/** Clients only, not cancelled; a client booked twice that day gets one row per slot. */
export function reminderQueue(entries: ScheduleEntry[]): ScheduleEntry[] {
  return entries.filter((e) => !e.is_non_client && e.status !== 'cancelled')
}

export function sentReminder(e: ScheduleEntry, reminders: Reminder[] | undefined): Reminder | undefined {
  return reminders?.find((r) => r.client_id === e.client_id && r.slot_time.slice(0, 5) === e.slot_time.slice(0, 5) && r.sent_at)
}
