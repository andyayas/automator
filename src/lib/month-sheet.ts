// Next month's schedule spreadsheet, in the clinic's day-tab design: one tab
// per working day, laid out like the sheet since its cleanup (2026-10-16):
//
//   A1:<last>2   "Physio Name" title, merged, light grey
//   row 3        "Time" + one column per therapist (names from the app's latest
//                schedule; staff names are never written in the repo)
//   rows 4–33    the sheet's slots "7h00 am" … "9h00 pm", "10h00 pm" (half hours,
//                no 9h30 pm), white booking cells
//   rows 34–36   "Total Hrs of Sessions", a blank row, "Notes", pink
//
// Colours, font and widths were taken from the October 2026 export; therapist
// columns are wider than they were. Pure: the Sheets API calls are in
// google-sheets.ts.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

const hex = (h: string) => ({ red: parseInt(h.slice(0, 2), 16) / 255, green: parseInt(h.slice(2, 4), 16) / 255, blue: parseInt(h.slice(4, 6), 16) / 255 })
export const DESIGN = {
  font: 'Arial',
  title: 'Physio Name',
  colours: { title: hex('D9D9D9'), time: hex('B7B7B7'), therapist: hex('999999'), slot: hex('D9D9D9'), cell: hex('FFFFFF'), footer: hex('F4CCCC') },
  widths: { time: 145, therapist: 190 },
  /** Minutes after midnight, exactly as the sheet has them: half hours 7 am–9 pm, then 10 pm. */
  slots: [...Array.from({ length: 29 }, (_, i) => 7 * 60 + i * 30), 22 * 60],
}

/** Mon–Sat of a month (the clinic is closed on Sundays), as tab names like the sheet's: "Mon 2 NOV". */
export function workingDayTabs(month: string): string[] {
  const [y, m] = month.split('-').map(Number)
  const tabs: string[] = []
  for (let d = new Date(y, m - 1, 1); d.getMonth() === m - 1; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0) tabs.push(`${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`)
  }
  return tabs
}

/** The file's name in Google Drive: "Physio November 2026". */
export function sheetFileName(month: string): string {
  return `Physio ${monthTitle(month)}`
}

/** "2026-11" -> "November 2026". */
export function monthTitle(month: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

/** The month after "2026-10" is "2026-11". */
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

/** The month whose sheet is still missing: this month's, else next month's (null when both exist). */
export function missingSheetMonth(links: Record<string, string>, today: string): string | null {
  const current = today.slice(0, 7)
  if (!links[current]) return current
  const next = nextMonth(current)
  return links[next] ? null : next
}

/** 420 -> "7h00 am", 1350 -> "10h30 pm": the sheet's own slot labels. */
export function slotLabel(minutes: number): string {
  const h = Math.floor(minutes / 60)
  return `${h % 12 === 0 ? 12 : h % 12}h${String(minutes % 60).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

type Colour = ReturnType<typeof hex>
const solid = { style: 'SOLID' }
const borders = { top: solid, bottom: solid, left: solid, right: solid }
const cell = (value: string | null, background: Colour, extra: { bold?: boolean; size?: number; center?: boolean; middle?: boolean } = {}) => ({
  ...(value === null ? {} : { userEnteredValue: { stringValue: value } }),
  userEnteredFormat: {
    backgroundColor: background,
    borders,
    verticalAlignment: extra.middle ? 'MIDDLE' : 'BOTTOM',
    ...(extra.center ? { horizontalAlignment: 'CENTER' } : {}),
    textFormat: { fontFamily: DESIGN.font, bold: Boolean(extra.bold), ...(extra.size ? { fontSize: extra.size } : {}) },
  },
})
type Cell = ReturnType<typeof cell>

/** One empty day tab's cells, for these therapists. */
export function dayGrid(therapists: string[]) {
  const n = Math.max(1, therapists.length)
  const names = Array.from({ length: n }, (_, i) => therapists[i] ?? '')
  const { colours: k } = DESIGN
  const row = (first: Cell, rest: (i: number) => Cell) => ({ values: [first, ...names.map((_, i) => rest(i))] })
  const rows = [
    row(cell(DESIGN.title, k.title, { bold: true, center: true, middle: true }), () => cell(null, k.title)),
    row(cell(null, k.title), () => cell(null, k.title)),
    row(cell('Time', k.time, { bold: true }), (i) => cell(names[i], k.therapist, { bold: true, center: true })),
  ]
  for (const t of DESIGN.slots) rows.push(row(cell(slotLabel(t), k.slot, { size: 12 }), () => cell(null, k.cell)))
  for (const label of ['Total Hrs of Sessions', null, 'Notes']) rows.push(row(cell(label, k.footer, { size: 12 }), () => cell(null, k.footer)))
  return {
    rowData: rows,
    columnMetadata: [{ pixelSize: DESIGN.widths.time }, ...names.map(() => ({ pixelSize: DESIGN.widths.therapist }))],
    columns: n + 1,
  }
}

/** The spreadsheets.create body for `month`. */
export function buildMonthSheet(month: string, therapists: string[]) {
  const day = dayGrid(therapists)
  const sheets = workingDayTabs(month).map((title, i) => {
    const sheetId = i + 1
    return {
      properties: { sheetId, title, index: i },
      data: [{ startRow: 0, startColumn: 0, rowData: day.rowData, columnMetadata: day.columnMetadata }],
      merges: [{ sheetId, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: day.columns }],
    }
  })
  return { properties: { title: sheetFileName(month), defaultFormat: { textFormat: { fontFamily: DESIGN.font } } }, sheets }
}
