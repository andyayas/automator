/** Today's date in the device's time zone, as YYYY-MM-DD. */
export function todayISO(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Yesterday in the device's time zone, as YYYY-MM-DD. */
export function yesterdayISO(now = new Date()): string {
  const d = new Date(now)
  d.setDate(d.getDate() - 1)
  return todayISO(d)
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** "2026-10-03" -> "3 Oct 2026" (or "3 Oct" with { short: true }). */
export function formatDate(iso: string | null | undefined, opts: { short?: boolean } = {}): string {
  if (!iso) return ''
  const date = new Date(`${iso}T00:00:00`)
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(opts.short ? {} : { year: 'numeric' }),
  })
}

/** 450 -> "$450", 37.5 -> "$37.50". */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Parses a number typed on a phone keyboard ("37,5" works too). Empty -> null. */
export function parseNumber(text: string): number | null {
  const cleaned = text.replace(',', '.').replace(/[^\d.-]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

export const numberText = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))

/** Package value per session: round(total / N), so 450 for 12 gives 38. */
export const perSessionValue = (price: number | null, sessions: number | null) =>
  price !== null && sessions ? Math.round(price / sessions) : null

/** A time of day the way the clinic writes it: "1:20 PM" (like the booking times). */
export function formatTime(value: Date | string | number): string {
  return new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}
