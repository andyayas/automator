// @vitest-environment node
// A synthetic template with the real template's layout (no logo, no clinic
// name) is built here, filled, and read back.
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { buildReport, type ReportData, type ReportRow } from './report.ts'

async function syntheticTemplate(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Daily Report')
  ws.getCell('C1').value = 'DAILY REPORT'
  ws.getCell('C2').value = 'Test Clinic'
  ws.getCell('C3').value = 'Date:'
  const bold = { font: { bold: true } }
  ws.getCell('A6').value = 'Insurance'
  ws.getCell('A6').style = { ...bold, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } } }
  ws.mergeCells('A6:F6')
  for (const c of ['A', 'B', 'C', 'D', 'E', 'F']) ws.getCell(`${c}7`).style = bold
  ws.getCell('A20').value = 'Insurance total'
  ws.getCell('B20').value = { formula: 'SUM(B8:B19)' }
  ws.mergeCells('D23:E23')
  ws.getCell('A48').value = 'Expense Details'
  ws.mergeCells('A48:B48')
  ws.getCell('E48').value = 'Total Clients'
  ws.getCell('A57').value = 'Total Expenses'
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

const row = (client: string, over: Partial<ReportRow> = {}): ReportRow => ({
  client,
  therapist: 'Therapist A',
  billed: 25,
  collected: 0,
  sessionNo: null,
  serialNumber: null,
  note: '',
  ...over,
})

const data: ReportData = {
  dateLabel: '16 October 2026',
  sections: {
    insurance: [row('Jane Testerson', { sessionNo: '3/10', serialNumber: 'S-1', collected: 5 }), row('Lina Example', { sessionNo: 1 })],
    package: [row('Omar Sample', { billed: 38, sessionNo: 9 })],
    per_session: Array.from({ length: 14 }, (_, i) => row(`Client ${i + 1}`, { billed: 45, collected: 45 })),
    free: [],
  },
  expenses: [
    { label: 'Coffee', amount: 6 },
    { label: 'Water 5 boxes', amount: 12 },
  ],
  otherIncome: [{ label: 'Test Insurer payment', amount: 900 }],
  totalClients: 17,
  packageNotPaid: 1,
}

async function filled(d: ReportData) {
  const out = new ExcelJS.Workbook()
  await out.xlsx.load((await buildReport(await syntheticTemplate(), d)) as unknown as ArrayBuffer)
  const ws = out.getWorksheet('Daily Report')!
  const find = (text: string) => {
    let found = ''
    ws.eachRow((r) => r.eachCell((c) => {
      if (!found && c.value === text) found = c.address
    }))
    return found
  }
  return { ws, find }
}

describe('buildReport', () => {
  it('keeps the header, writes the date in C3, and hides gridlines like the template', async () => {
    const { ws } = await filled(data)
    expect(ws.views[0].showGridLines).toBe(false)
    expect(ws.getCell('C1').value).toBe('DAILY REPORT')
    expect(ws.getCell('C2').value).toBe('Test Clinic')
    expect(ws.getCell('C3').value).toBe('Date: 16 October 2026')
  })

  it('lays out sections with a Therapist column and as many rows as needed', async () => {
    const { ws, find } = await filled(data)
    expect(find('Insurance')).toBe('A6')
    expect(ws.getRow(7).values).toEqual([undefined, 'Client', 'Therapist', 'Billed', 'Collected', 'Session No.', 'Serial Number', 'Extra Note'])
    expect(ws.getCell('A8').value).toBe('Jane Testerson')
    expect(ws.getCell('F8').value).toBe('S-1')
    expect(ws.getCell('E8').value).toBe('3/10')
    // Her choice: data centred horizontally.
    for (const addr of ['A8', 'C8', 'E8', 'F8']) expect(ws.getCell(addr).alignment?.horizontal).toBe('center')
    expect(ws.getCell('A10').value).toBe('Insurance total')
    expect((ws.getCell('C10').value as { formula: string }).formula).toBe('SUM(C8:C9)')

    // 14 per-session clients: more than the template's 10 rows.
    const per = Number(find('Per Session').slice(1))
    expect(ws.getCell(`A${per + 2}`).value).toBe('Client 1')
    expect(ws.getCell(`A${per + 15}`).value).toBe('Client 14')
    expect(ws.getCell(`A${per + 16}`).value).toBe('Per Session total')
  })

  it('adds a Free table only on days with free sessions', async () => {
    expect((await filled(data)).find('Free')).toBe('')
    const withFree = await filled({ ...data, sections: { ...data.sections, free: [row('Rami Testa')] } })
    const free = Number(withFree.find('Free').slice(1))
    expect(withFree.ws.getCell(`A${free + 2}`).value).toBe('Rami Testa')
  })

  it('writes expenses and a summary that points at the section totals', async () => {
    const { ws, find } = await filled(data)
    const exp = Number(find('Expense Details').slice(1))
    expect(ws.getCell(`A${exp + 1}`).value).toBe('Coffee')
    expect(ws.getCell(`C${exp + 2}`).value).toBe(12)
    const clients = find('Total Clients')
    expect(ws.getCell(`G${clients.slice(1)}`).value).toBe(17)
    const notPaid = find('Total Package Not Paid')
    expect(ws.getCell(`G${notPaid.slice(1)}`).value).toBe(1)
    const billed = ws.getCell(`G${find('Total Billed').slice(1)}`).value as { formula: string }
    expect(billed.formula).toMatch(/^C\d+\+C\d+\+C\d+$/)
    const net = ws.getCell(`G${find('Net').slice(1)}`).value as { formula: string; result: number }
    expect(net.formula).toMatch(/^G\d+-G\d+$/)
    // Collected 5 + 0 + 14×45 = 635, plus other income 900, minus expenses 18.
    expect(net.result).toBe(635 + 900 - 18)
    const other = Number(find('Other Income').slice(1))
    expect(ws.getCell(`A${other + 1}`).value).toBe('Test Insurer payment')
    expect(ws.getCell(`C${other + 1}`).value).toBe(900)
    const total = ws.getCell(`G${find('Income (total)').slice(1)}`).value as { result: number }
    expect(total.result).toBe(635 + 900)
  })
})

describe('with the clinic’s built-in template', () => {
  it('leaves zero amounts blank and hides Excel’s “number stored as text” warning', async () => {
    const { readFileSync } = await import('node:fs')
    const JSZip = (await import('jszip')).default
    const template = new Uint8Array(readFileSync(new URL('../assets/daily-report-template.xlsx', import.meta.url)))
    const out = await buildReport(template, {
      ...data,
      sections: { ...data.sections, insurance: [row('Jane Testerson', { serialNumber: '12345', billed: 25, collected: 0 })] },
    })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(out as unknown as ArrayBuffer)
    const ws = wb.getWorksheet('Daily Report')!
    expect(ws.getCell('D8').value).toBe(0)
    expect(ws.getCell('D8').numFmt?.split(';')[2]).toBe('') // zero shows nothing, not "-"
    expect(ws.getCell('F8').value).toBe('12345')
    const zip = await JSZip.loadAsync(out)
    const sheet = await zip.file(Object.keys(zip.files).find((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))!)!.async('string')
    expect(sheet).toContain('numberStoredAsText="1"')
    expect(sheet).toContain('twoDigitTextYear="1"')
    // It must come before the logo's drawing, or Excel would call the file damaged.
    if (sheet.includes('<drawing')) expect(sheet.indexOf('<ignoredErrors')).toBeLessThan(sheet.indexOf('<drawing'))
  })
})
