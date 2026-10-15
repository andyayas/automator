// WhatsApp reminder text and links. Nothing is ever sent automatically: the
// link opens WhatsApp with the message filled in, and she presses Send.

import { formatSlotTime } from './schedule'

/** The clinic's current reminder (CLAUDE.md). {sender_name} comes from settings. */
export const DEFAULT_REMINDER_TEMPLATE = `Hello,
Your physiotherapy session is scheduled for {weekday} {date} at {time}.

Please reply with:
• C to confirm
• X to cancel
• R to reschedule

Note: As per our clinic policy, same-day cancellations are subject to the full session fee.

Kind regards,
{sender_name}`

export const REMINDER_PLACEHOLDERS = ['{name}', '{weekday}', '{date}', '{time}', '{sender_name}'] as const

/** Fills in the template. Unknown placeholders are left as typed. */
export function renderReminder(
  template: string,
  values: { name: string; date: string; slotTime: string; senderName: string },
): string {
  const day = new Date(`${values.date}T00:00:00`)
  const replacements: Record<string, string> = {
    '{name}': values.name,
    '{weekday}': day.toLocaleDateString('en-GB', { weekday: 'long' }),
    '{date}': day.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }),
    '{time}': formatSlotTime(values.slotTime.slice(0, 5)),
    '{sender_name}': values.senderName,
  }
  return template.replace(/\{[a-z_]+\}/g, (token) => replacements[token] ?? token)
}

/** https://wa.me/<digits>?text=<message>; wa.me wants the number with no "+". */
export function whatsappUrl(phoneDigits: string, message: string): string {
  return `https://wa.me/${phoneDigits.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`
}

/** The day reminders are usually sent for: tomorrow. */
export function tomorrowISO(now = new Date()): string {
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
