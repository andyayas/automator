// Parses the decrypted cash statement workbook: one tab per month, headers on
// row 3, data from row 7. Columns are found from the headers because they move
// (January–June start one column further right than July onwards).

import type { WorkBook } from 'xlsx'
import { utils } from 'xlsx'
import { toISODate } from './dates'
import { normalizeName } from './names'

export type CashKind = 'session' | 'package' | 'insurance_copay' | 'insurer_payment' | 'expense' | 'other'
export type CashMethod = 'cash' | 'pos' | 'transfer'

export type CashRow = {
  sheet: string
  /** 1-based spreadsheet row. */
  row: number
  date: string
  nameRaw: string
  description: string
  voucher: string | null
  debit: number | null
  credit: number | null
  method: CashMethod
  /** Amount read from the description when no debit/credit is filled (POS, card, transfer). */
  descAmount: number | null
  kind: CashKind
  /** N from "Package of N", when present. */
  packageSessions: number | null
  /** Stable identity across re-uploads: date + voucher, or a content key. */
  sourceKey: string
}

export type CashParseResult = {
  rows: CashRow[]
  skipped: number
  sheets: string[]
  /** Dates corrected because the year was clearly mistyped (e.g. 2029 in a 2026 file). */
  fixedDates: string[]
}

const HEADERS: Record<string, keyof Columns> = {
  date: 'date',
  'client name': 'name',
  name: 'name',
  description: 'description',
  'receipt pv': 'voucher',
  'debit in': 'debit',
  'credit in': 'credit',
}
type Columns = { date: number; name: number; description: number; voucher: number; debit: number; credit: number }

const PACKAGE = /(package|pkg)\s+of\s+(\d+)/i
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export { toISODate }

export function parseCashStatement(workbook: WorkBook, opts: { insurers?: string[] } = {}): CashParseResult {
  const insurers = (opts.insurers ?? []).map(normalizeName).filter(Boolean)
  const rows: Array<Omit<CashRow, 'sourceKey'> & { baseKey: (date: string) => string }> = []
  let skipped = 0
  const sheets: string[] = []

  for (const sheet of workbook.SheetNames) {
    const data = utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], { header: 1, blankrows: true, raw: true, defval: null })
    const cols = findColumns(data)
    if (!cols) continue
    sheets.push(sheet)
    let currentDate: string | null = null

    for (let i = 6; i < data.length; i++) {
      const r = data[i] ?? []
      const date = toISODate(r[cols.date])
      if (date) currentDate = date
      const nameRaw = text(r[cols.name])
      const description = text(r[cols.description])
      const voucherRaw = text(r[cols.voucher])
      const debit = money(r[cols.debit])
      const credit = money(r[cols.credit])
      if (!nameRaw && !description && !voucherRaw && debit === null && credit === null) continue

      const descLower = description.toLowerCase()
      // Repeated header rows and monthly "total" lines are not transactions.
      if (descLower === 'description' || nameRaw.toLowerCase() === 'client name' || /^total\b/.test(descLower) || /^total\b/i.test(nameRaw)) {
        skipped++
        continue
      }
      if (!currentDate) {
        skipped++
        continue
      }

      const voucher = normalizeVoucher(voucherRaw)
      const descAmount = debit === null && credit === null ? amountIn(description) : null
      const method: CashMethod = /\b(wish|whish|omt)\b/.test(descLower)
        ? 'transfer'
        : /pos|\bcard\b|\bvisa\b/.test(descLower) || descAmount !== null
          ? 'pos'
          : 'cash'
      const pkg = PACKAGE.exec(description)
      const name = normalizeName(nameRaw)
      const kind: CashKind =
        (voucher?.startsWith('pv') || credit !== null) && debit === null
          ? 'expense'
          : pkg || /\bpackage\b/.test(descLower)
            ? 'package'
            : /insurance\s+difference/.test(descLower)
              ? 'insurance_copay'
              : insurers.some((ins) => name === ins || name.startsWith(`${ins} `))
                ? 'insurer_payment'
                : /session/.test(descLower)
                  ? 'session'
                  : 'other'

      const contentKey = `${name}|${normalizeName(description)}|${debit ?? credit ?? descAmount ?? ''}`
      rows.push({
        baseKey: (date) => (voucher ? `${date}|${voucher}` : `${date}|${contentKey}`),
        sheet,
        row: i + 1,
        date: currentDate,
        nameRaw,
        description,
        voucher,
        debit,
        credit,
        method,
        descAmount,
        kind,
        packageSessions: pkg ? Number(pkg[2]) : null,
      })
    }
  }

  // A year that differs from the rest of the file, in a tab named after that
  // date's month, is a typo (2029-03-28 in "March" of a 2026 file).
  const yearCounts = new Map<string, number>()
  for (const r of rows) yearCounts.set(r.date.slice(0, 4), (yearCounts.get(r.date.slice(0, 4)) ?? 0) + 1)
  const mainYear = [...yearCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const fixedDates: string[] = []
  for (const r of rows) {
    const month = Number(r.date.slice(5, 7)) - 1
    if (mainYear && !r.date.startsWith(mainYear) && r.sheet.trim().toLowerCase().startsWith(MONTHS[month])) {
      const fixed = `${mainYear}${r.date.slice(4)}`
      fixedDates.push(`${r.sheet} row ${r.row}: ${r.date} read as ${fixed}`)
      r.date = fixed
    }
  }

  const seenKeys = new Map<string, number>()
  const result: CashRow[] = rows.map(({ baseKey, ...r }) => {
    const key = baseKey(r.date)
    const n = (seenKeys.get(key) ?? 0) + 1
    seenKeys.set(key, n)
    return { ...r, sourceKey: n === 1 ? key : `${key}#${n}` }
  })
  return { rows: result, skipped, sheets, fixedDates }
}

/** Money in for a row: debit, or the amount written in the description (POS etc.). */
export const amountReceived = (r: CashRow) => r.debit ?? r.descAmount ?? 0

function findColumns(data: unknown[][]): Columns | null {
  for (let i = 0; i < Math.min(6, data.length); i++) {
    const found: Partial<Columns> = {}
    ;(data[i] ?? []).forEach((cell, c) => {
      const field = HEADERS[normalizeName(cell)]
      if (field && found[field] === undefined) found[field] = c
    })
    if (Object.keys(HEADERS).every((h) => found[HEADERS[h]] !== undefined)) return found as Columns
  }
  return null
}

function text(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim()
}

function money(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0 ? v : null
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/[$,\s]/g, ''))
    return Number.isFinite(n) && n !== 0 ? n : null
  }
  return null
}

/** "…45$ POS", "POS 450$", "$45" -> the amount; numbers like "12 session" are ignored. */
export function amountIn(description: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*\$|\$\s*(\d+(?:\.\d+)?)/.exec(description)
  return m ? Number(m[1] ?? m[2]) : null
}

function normalizeVoucher(v: string): string | null {
  const compact = v.toLowerCase().replace(/\s+/g, '')
  return compact ? compact : null
}

