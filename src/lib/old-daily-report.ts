// Reads the hand-made daily reports (one tab per day, e.g. "Tue Sep 22").
// Used for the go-live seed and, in phase 4, as ground truth for tests.
// The layout moves between days, so sections are found by their labels: the
// client table starts under "Client Name" and ends at the first blank row or a
// "Maintenance Follow-Up" heading. Per-client notes are ignored (the new
// template's Extra Note is left for her to fill in by hand).

import type { WorkBook } from 'xlsx'
import { utils } from 'xlsx'
import { normalizeName } from './names'

export type OldInfo = 'insurance' | 'package' | 'cash' | 'free' | 'pos' | 'blank' | 'other'

export type OldReportRow = {
  date: string
  name: string
  therapist: string
  info: OldInfo
  infoRaw: string
  paid: number | null
  billed: number | null
}

export type OldReportDay = { tab: string; date: string; rows: OldReportRow[] }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export function parseOldDailyReports(workbook: WorkBook, year: number): OldReportDay[] {
  const days: OldReportDay[] = []
  for (const tab of workbook.SheetNames) {
    const m = /\b([a-z]{3})[a-z]*\s+(\d{1,2})\b/i.exec(tab)
    const month = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1
    if (!m || month < 0) continue
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`

    const data = utils.sheet_to_json<unknown[]>(workbook.Sheets[tab], { header: 1, blankrows: true, raw: true, defval: null })
    const header = data.findIndex((r) => normalizeName(r?.[0]) === 'client name')
    if (header < 0) continue

    const rows: OldReportRow[] = []
    for (let i = header + 1; i < data.length; i++) {
      const r = data[i] ?? []
      const name = cellText(r[0])
      if (!name || /follow/i.test(name)) break
      const infoRaw = cellText(r[2])
      rows.push({
        date,
        name,
        therapist: cellText(r[1]),
        info: classify(infoRaw),
        infoRaw,
        paid: typeof r[3] === 'number' ? r[3] : null,
        billed: typeof r[4] === 'number' ? r[4] : null,
      })
    }
    days.push({ tab, date, rows })
  }
  return days.sort((a, b) => a.date.localeCompare(b.date))
}

function classify(raw: string): OldInfo {
  const v = raw.toLowerCase()
  if (!v) return 'blank'
  if (v.startsWith('insurance')) return 'insurance'
  if (v.startsWith('package')) return 'package'
  if (v.startsWith('cash')) return 'cash'
  if (v.startsWith('free')) return 'free'
  if (/\bpos\b|pos$/.test(v)) return 'pos'
  return 'other'
}

const cellText = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim())
