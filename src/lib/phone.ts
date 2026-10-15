/**
 * Turns a phone cell into the digits-only form wa.me expects (no "+"), or null.
 *
 * Contacts stores phones as numbers that can read back as floats
 * ("9613001272.0"). Almost all already include a country code, including
 * some foreign ones (971, 44, ...), so 961 is only added to short local
 * numbers: 7–8 digits, with or without a leading 0.
 */
export function normalizePhone(value: unknown): string | null {
  if (value === null || value === undefined) return null
  let text: string
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    text = Number.isInteger(value) ? value.toFixed(0) : String(value)
  } else {
    text = String(value).trim()
  }
  text = text.replace(/\.0+$/, '')
  if (/[^\d\s+().\-/]/.test(text)) return null
  let digits = text.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (!digits) return null

  if (digits.length === 8 && digits.startsWith('0')) digits = '961' + digits.slice(1)
  else if (digits.length === 7 || digits.length === 8) digits = '961' + digits

  return /^[0-9]{9,15}$/.test(digits) ? digits : null
}

/** "96171123456" -> "+961 71 123 456" for display. */
export function formatPhone(digits: string | null | undefined): string {
  if (!digits) return ''
  const local = digits.startsWith('961') ? digits.slice(3) : null
  if (local && (local.length === 7 || local.length === 8)) {
    const head = local.length === 7 ? local.slice(0, 1) : local.slice(0, 2)
    const rest = local.slice(head.length)
    return `+961 ${head} ${rest.slice(0, 3)} ${rest.slice(3)}`
  }
  return `+${digits}`
}
