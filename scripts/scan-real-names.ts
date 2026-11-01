// Blocks commits that contain a real client name. Local only: it reads the
// names from samples/ (Contacts tab, schedule bookings, old daily reports) and
// checks the lines being committed. Prints file:line only, never the name.
//
//   npx tsx scripts/scan-real-names.ts            scan staged changes (pre-commit)
//   npx tsx scripts/scan-real-names.ts --all      scan every tracked file

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { read } from 'xlsx'
import { parseContacts } from '../src/lib/contacts-xlsx.ts'
import { sheetRows } from '../src/lib/sheet-rows.ts'
import { normalizeName } from '../src/lib/names.ts'
import { parseOldDailyReports } from '../src/lib/old-daily-report.ts'
import { DEFAULT_NON_CLIENT_PATTERNS, isNonClient, parseScheduleCell } from '../src/lib/schedule-cell.ts'

const SAMPLES = 'samples'
if (!existsSync(SAMPLES)) process.exit(0)

const names = new Set<string>()
const add = (raw: unknown) => {
  const n = normalizeName(raw)
  // Two words or more: single first names are too common to be meaningful.
  // Non-client entries ("labneh time") are not people.
  if (n.split(' ').length >= 2 && n.length >= 7 && !isNonClient(n, DEFAULT_NON_CLIENT_PATTERNS)) names.add(n)
}

for (const file of readdirSync(SAMPLES).filter((f) => f.endsWith('.xlsx') && !/cash statement/i.test(f))) {
  const wb = read(readFileSync(join(SAMPLES, file)), { type: 'buffer' })
  if (wb.SheetNames.some((n) => n.trim().toLowerCase() === 'contacts')) {
    for (const c of parseContacts(wb).contacts) add(c.name)
    for (const tab of wb.SheetNames) {
      const rows = sheetRows(wb.Sheets[tab])
      // Therapist columns are the ones with a name in row 3 (B/D/F in old exports, B/C/D… since the cleanup).
      const cols = [1, 2, 3, 4, 5, 6, 7, 8].filter((c) => typeof rows[2]?.[c] === 'string' && String(rows[2][c]).trim())
      for (let r = 3; r <= 32; r++)
        for (const c of cols) {
          const cell = parseScheduleCell(rows[r]?.[c])
          if (cell.kind === 'bookings') cell.bookings.forEach((b) => add(b.name))
        }
    }
  } else {
    for (const day of parseOldDailyReports(wb, 2026)) day.rows.forEach((r) => add(r.name))
  }
}

const all = process.argv.includes('--all')
const hits: string[] = []
const check = (file: string, line: number, text: string) => {
  const t = ` ${normalizeName(text)} `
  for (const n of names) if (t.includes(` ${n} `)) return hits.push(`${file}:${line}`)
}

if (all) {
  for (const file of execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)) {
    if (/\.(bin|png|svg)$/.test(file) || !existsSync(file)) continue
    readFileSync(file, 'utf8').split('\n').forEach((l, i) => check(file, i + 1, l))
  }
} else {
  const diff = execFileSync('git', ['diff', '--cached', '-U0', '--no-color'], { encoding: 'utf8' })
  let file = ''
  let line = 0
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) file = l.slice(6)
    else if (l.startsWith('@@')) line = Number(/\+(\d+)/.exec(l)?.[1] ?? 0) - 1
    else if (l.startsWith('+')) check(file, ++line, l.slice(1))
  }
}

if (hits.length) {
  console.error(`Refusing: ${hits.length} line(s) contain a real client name from samples/:`)
  for (const h of hits) console.error(`  ${h}`)
  process.exit(1)
}
