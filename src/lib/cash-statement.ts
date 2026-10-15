// Parses the decrypted cash statement workbook: one tab per month, headers on
// row 3, data from row 7. Columns are found from the headers because they move
// (January–June start one column further right than July onwards).

import type { WorkBook } from 'xlsx'
import { SSF, utils } from 'xlsx'
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

export type CashParseResult = { rows: CashRow[]; skipped: number; sheets: string[] }

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

export function parseCashStatement(workbook: WorkBook, opts: { insurers?: string[] } = {}): CashParseResult {
  const insurers = (opts.insurers ?? []).map(normalizeName).filter(Boolean)
  const rows: CashRow[] = []
  const seenKeys = new Map<string, number>()
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

      const baseKey = voucher
        ? `${currentDate}|${voucher}`
        : `${currentDate}|${name}|${normalizeName(description)}|${debit ?? credit ?? descAmount ?? ''}`
      const n = (seenKeys.get(baseKey) ?? 0) + 1
      seenKeys.set(baseKey, n)

      rows.push({
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
        sourceKey: n === 1 ? baseKey : `${baseKey}#${n}`,
      })
    }
  }
  return { rows, skipped, sheets }
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

/** Date cell -> YYYY-MM-DD. Accepts Date objects, Excel serials and "15-sep-26" style text. */
export function toISODate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = SSF.parse_date_code(v)
    return `${d.y}-${pad(d.m)}-${pad(d.d)}`
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

const pad = (n: number) => String(n).padStart(2, '0')
