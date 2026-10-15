// Fills the daily report template. The top of the template (logo, title,
// clinic name, rows 1–4) is kept exactly; below it the sections are laid out
// with as many rows as the day needs (her decision: dynamic sections, a
// Therapist column, a Free table when there are free sessions), reusing the
// template's own cell styles. Totals stay Excel formulas so the file still adds
// up if she edits it.

import ExcelJS from 'exceljs'
import type { BillingType } from './day-builder'

export type ReportRow = {
  client: string
  therapist: string
  billed: number
  collected: number
  sessionNo: number | null
  serialNumber: string | null
  note: string
}
export type ReportData = {
  dateLabel: string
  sections: Record<BillingType, ReportRow[]>
  expenses: Array<{ label: string; amount: number }>
  totalClients: number
  packageNotPaid: number
}

type Style = Partial<ExcelJS.Style>
const FIRST_LAYOUT_ROW = 6
const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const
const WIDTHS = { A: 26, B: 16, C: 11, D: 11, E: 12, F: 20, G: 30 }

/** Each section's columns: [header, field, from column, to column]. */
type Col = [string, keyof ReportRow | null, string, string]
const SECTION_COLUMNS: Record<BillingType, Col[]> = {
  insurance: [
    ['Client', 'client', 'A', 'A'],
    ['Therapist', 'therapist', 'B', 'B'],
    ['Billed', 'billed', 'C', 'C'],
    ['Collected', 'collected', 'D', 'D'],
    ['Session No.', 'sessionNo', 'E', 'E'],
    ['Serial Number', 'serialNumber', 'F', 'F'],
    ['Extra Note', 'note', 'G', 'G'],
  ],
  package: [
    ['Client', 'client', 'A', 'A'],
    ['Therapist', 'therapist', 'B', 'B'],
    ['Billed', 'billed', 'C', 'C'],
    ['Collected', 'collected', 'D', 'D'],
    ['Session No.', 'sessionNo', 'E', 'E'],
    ['Extra Note', 'note', 'F', 'G'],
  ],
  per_session: [
    ['Client', 'client', 'A', 'A'],
    ['Therapist', 'therapist', 'B', 'B'],
    ['Billed', 'billed', 'C', 'C'],
    ['Collected', 'collected', 'D', 'D'],
    ['Extra Note', 'note', 'E', 'G'],
  ],
  free: [
    ['Client', 'client', 'A', 'A'],
    ['Therapist', 'therapist', 'B', 'B'],
    ['Extra Note', 'note', 'C', 'G'],
  ],
}
const TITLES: Record<BillingType, string> = { insurance: 'Insurance', package: 'Package', per_session: 'Per Session', free: 'Free' }

export async function buildReport(template: ArrayBuffer | Uint8Array, data: ReportData): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(template as ArrayBuffer)
  const ws = wb.getWorksheet('Daily Report') ?? wb.worksheets[0]
  if (!ws) throw new Error('The template has no sheet.')
  fillReportSheet(ws, data)
  // Excel recalculates on open (the cached results are for previews).
  wb.calcProperties = { ...wb.calcProperties, fullCalcOnLoad: true }
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

/**
 * A month in one file: one tab per day (e.g. "Thu Oct 15"), each a copy of the
 * template (logo included) filled like the daily report.
 */
export async function buildMonthReport(
  template: ArrayBuffer | Uint8Array,
  days: Array<{ sheetName: string; data: ReportData }>,
): Promise<Uint8Array> {
  if (!days.length) throw new Error('No confirmed days in this month yet.')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(template as ArrayBuffer)
  const tpl = wb.getWorksheet('Daily Report') ?? wb.worksheets[0]
  if (!tpl) throw new Error('The template has no sheet.')
  // Copying the sheet model copies its cells, styles, merges and the logo.
  const model = JSON.stringify(tpl.model)
  for (const day of days) {
    const ws = wb.addWorksheet(day.sheetName)
    ws.model = { ...(JSON.parse(model) as ExcelJS.WorksheetModel), id: ws.id, name: day.sheetName }
    fillReportSheet(ws, day.data)
  }
  wb.removeWorksheet(tpl.id)
  wb.calcProperties = { ...wb.calcProperties, fullCalcOnLoad: true }
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

/** Fills one sheet that holds a copy of the template. */
function fillReportSheet(ws: ExcelJS.Worksheet, data: ReportData) {
  // Styles taken from the template's own cells, so its look carries over.
  const style = (addr: string): Style => JSON.parse(JSON.stringify(ws.getCell(addr).style ?? {}))
  const s = {
    title: style('A6'),
    header: style('A7'),
    headerNum: style('B7'),
    text: style('A8'),
    num: style('B8'),
    totalLabel: style('A20'),
    totalNum: style('B20'),
    expHeader: style('A48'),
    expHeaderNum: style('C48'),
    expText: style('A49'),
    expNum: style('C49'),
    expTotal: style('A57'),
    expTotalNum: style('C57'),
    sumLabel: style('E48'),
    sumValue: style('F48'),
    incomeHeader: style('E56'),
  }
  const heights = { title: ws.getRow(6).height, header: ws.getRow(7).height, data: ws.getRow(8).height }

  // Clear everything below the header block: merges, values, styles, heights.
  const merges = ((ws.model as unknown as { merges?: string[] }).merges ?? []).slice()
  for (const range of merges) {
    const top = Number(/[A-Z]+(\d+)/.exec(range)?.[1] ?? 0)
    if (top >= FIRST_LAYOUT_ROW - 1) ws.unMergeCells(range)
  }
  const lastRow = Math.max(ws.rowCount, ws.actualRowCount, 80)
  for (let row = FIRST_LAYOUT_ROW - 1; row <= lastRow; row++) {
    const r = ws.getRow(row)
    r.height = undefined as unknown as number
    for (let c = 1; c <= 12; c++) {
      const cell = r.getCell(c)
      cell.value = null
      cell.style = {}
    }
  }
  // The decorative band under the title (row 4) runs across the new column G too.
  ws.getCell('G4').style = style('F4')

  ws.getCell('C3').value = `Date: ${data.dateLabel}`
  for (const [col, width] of Object.entries(WIDTHS)) ws.getColumn(col).width = width

  let r = FIRST_LAYOUT_ROW
  const put = (addr: string, value: ExcelJS.CellValue, st: Style) => {
    const cell = ws.getCell(addr)
    cell.value = value
    cell.style = JSON.parse(JSON.stringify(st))
  }
  const span = (from: string, to: string, row: number, value: ExcelJS.CellValue, st: Style) => {
    for (const c of COLUMNS.slice(COLUMNS.indexOf(from as never), COLUMNS.indexOf(to as never) + 1)) put(`${c}${row}`, null, st)
    put(`${from}${row}`, value, st)
    if (from !== to) ws.mergeCells(`${from}${row}:${to}${row}`)
  }
  const isNumber = (field: keyof ReportRow | null) => field === 'billed' || field === 'collected' || field === 'sessionNo'
  // Session numbers are counts, not money: same look as the amount cells, plain number format.
  const countStyle: Style = { ...s.num, numFmt: '0' }
  const cellStyle = (field: keyof ReportRow | null) => (field === 'sessionNo' ? countStyle : isNumber(field) ? s.num : s.text)
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

  const totals: Partial<Record<BillingType, { billed: string; collected: string; billedValue: number; collectedValue: number }>> = {}
  for (const type of ['insurance', 'package', 'per_session', 'free'] as BillingType[]) {
    const rows = data.sections[type]
    if (type === 'free' && rows.length === 0) continue
    const cols = SECTION_COLUMNS[type]
    span('A', 'G', r, TITLES[type], s.title)
    if (heights.title) ws.getRow(r).height = heights.title
    r++
    for (const [label, field, from, to] of cols) span(from, to, r, label, isNumber(field) ? s.headerNum : s.header)
    if (heights.header) ws.getRow(r).height = heights.header
    r++
    const first = r
    // An empty section still gets one blank row so the table reads clearly.
    for (const row of rows.length ? rows : [null]) {
      for (const [, field, from, to] of cols) {
        const value = row && field ? (row[field] ?? null) : null
        span(from, to, r, value === '' ? null : (value as ExcelJS.CellValue), cellStyle(field))
      }
      if (heights.data) ws.getRow(r).height = heights.data
      r++
    }
    const last = r - 1
    if (type !== 'free') {
      put(`A${r}`, `${TITLES[type]} total`, s.totalLabel)
      put(`B${r}`, null, s.totalLabel)
      const billedValue = sum(rows.map((x) => x.billed))
      const collectedValue = sum(rows.map((x) => x.collected))
      put(`C${r}`, { formula: `SUM(C${first}:C${last})`, result: billedValue }, s.totalNum)
      put(`D${r}`, { formula: `SUM(D${first}:D${last})`, result: collectedValue }, s.totalNum)
      for (const c of ['E', 'F', 'G']) put(`${c}${r}`, null, s.totalLabel)
      totals[type] = { billed: `C${r}`, collected: `D${r}`, billedValue, collectedValue }
      r++
    }
    r++ // blank line between sections
  }

  // Expenses (left) and summary (right), side by side as in the template.
  const top = r
  span('A', 'B', r, 'Expense Details', s.expHeader)
  put(`C${r}`, 'Amount', s.expHeaderNum)
  const expRows = data.expenses.length ? data.expenses : [{ label: '', amount: null as unknown as number }]
  expRows.forEach((e, i) => {
    span('A', 'B', top + 1 + i, e.label || null, s.expText)
    put(`C${top + 1 + i}`, e.amount ?? null, s.expNum)
  })

  const ref = (k: BillingType, f: 'billed' | 'collected') => totals[k]?.[f]
  const val = (k: BillingType, f: 'billedValue' | 'collectedValue') => totals[k]?.[f] ?? 0
  const paid = ['insurance', 'package', 'per_session'] as BillingType[]
  const totalBilled = sum(paid.map((k) => val(k, 'billedValue')))
  const totalCollected = sum(paid.map((k) => val(k, 'collectedValue')))
  const totalExpenses = sum(data.expenses.map((e) => e.amount))
  const f = (formula: string, result: number): ExcelJS.CellValue => ({ formula, result })
  const summary: Array<[string, ExcelJS.CellValue]> = [
    ['Total Clients', data.totalClients],
    ['Total Billed', f(paid.map((k) => ref(k, 'billed')).join('+'), totalBilled)],
    ['Total Collected', f(paid.map((k) => ref(k, 'collected')).join('+'), totalCollected)],
    ['Total Insurance Not Paid', f(`${ref('insurance', 'billed')}-${ref('insurance', 'collected')}`, val('insurance', 'billedValue') - val('insurance', 'collectedValue'))],
    ['Total Insurance Paid', f(`${ref('insurance', 'collected')}`, val('insurance', 'collectedValue'))],
    ['Total Package Paid', f(`${ref('package', 'collected')}`, val('package', 'collectedValue'))],
    ['Total Package Not Paid', data.packageNotPaid],
  ]
  // Money rows use the template's currency format; the two counts stay plain numbers.
  const money: Style = { ...s.sumValue, numFmt: s.num.numFmt ?? s.sumValue.numFmt }
  const counts = new Set(['Total Clients', 'Total Package Not Paid'])
  summary.forEach(([label, value], i) => {
    put(`F${top + i}`, label, s.sumLabel)
    put(`G${top + i}`, value, counts.has(label) ? s.sumValue : money)
  })
  const collectedRow = top + 2

  const expTotal = top + 1 + expRows.length
  span('A', 'B', expTotal, 'Total Expenses', s.expTotal)
  put(`C${expTotal}`, f(`SUM(C${top + 1}:C${expTotal - 1})`, totalExpenses), s.expTotalNum)

  const incomeTop = top + summary.length + 1
  span('F', 'G', incomeTop, 'Income / Expenses', s.incomeHeader)
  put(`F${incomeTop + 1}`, 'Income (total collected)', s.sumLabel)
  put(`G${incomeTop + 1}`, f(`G${collectedRow}`, totalCollected), money)
  put(`F${incomeTop + 2}`, 'Expenses', s.sumLabel)
  put(`G${incomeTop + 2}`, f(`C${expTotal}`, totalExpenses), money)
  put(`F${incomeTop + 3}`, 'Net', s.sumLabel)
  put(`G${incomeTop + 3}`, f(`G${incomeTop + 1}-G${incomeTop + 2}`, totalCollected - totalExpenses), money)

  ws.pageSetup = { ...ws.pageSetup, fitToPage: true, fitToWidth: 1, fitToHeight: 0, orientation: 'portrait' }
}
