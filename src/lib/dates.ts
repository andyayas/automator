const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')

/** Date cell -> YYYY-MM-DD. Accepts Date objects, Excel serials and "15-sep-26" style text. */
export function toISODate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // Excel serial: days since 1899-12-30.
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000)
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  if (typeof v === 'string') {
    const m = /^(\d{1,2})[-/ ]([a-z]{3})[a-z]*[-/ ](\d{2,4})$/i.exec(v.trim())
    if (m) {
      const month = MONTHS.indexOf(m[2].toLowerCase())
      if (month >= 0) {
        const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
        return `${year}-${pad(month + 1)}-${pad(Number(m[1]))}`
      }
    }
  }
  return null
}
