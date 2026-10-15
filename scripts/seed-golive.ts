// Go-live seed: proposes the packages that are still open, with sessions used
// so far, from the files in samples/. Local only, never deployed.
//
//   npm run seed                       dry run: writes samples/seed-report.md
//   npm run seed -- --until=2026-10-14 count sessions up to this date (default: yesterday)
//   npm run seed -- --apply            signs in as her and inserts the proposals
//
// Everything it inserts is `proposed`: it counts for nothing until she accepts
// it on the Today screen. Insurance approvals are not seeded (serial numbers
// are in no file); the report lists the insurance clients to enter by hand.
// The report contains real names and stays in samples/ (gitignored).

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { createClient } from '@supabase/supabase-js'
import { read, utils, type WorkBook } from 'xlsx'
import type { Database } from '../src/lib/database.types.ts'
import { amountReceived, parseCashStatement, toISODate, type CashRow } from '../src/lib/cash-statement.ts'
import { parseContacts } from '../src/lib/contacts.ts'
import { createNameMatcher, normalizeName, tokenSortRatio, type NameMatch } from '../src/lib/names.ts'
import { decryptOfficeFile } from '../src/lib/office-crypto.ts'
import { parseOldDailyReports, type OldReportRow } from '../src/lib/old-daily-report.ts'
import { parseScheduleCell, type ParsedBooking } from '../src/lib/schedule-cell.ts'

const SAMPLES = 'samples'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** Package payments for the same client within this many days are treated as instalments of one package. */
const INSTALMENT_WINDOW_DAYS = 90

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const until = args.find((a) => a.startsWith('--until='))?.slice(8) ?? yesterday()

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

type Booking = ParsedBooking & { date: string; slot: string; therapist: string }

function samplesMatching(re: RegExp): string[] {
  return readdirSync(SAMPLES)
    .filter((f) => re.test(f))
    .map((f) => join(SAMPLES, f))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
}

const monthRe = MONTHS.join('|')
const scheduleFiles = samplesMatching(new RegExp(`^(${monthRe}) \\d{4}\\.xlsx$`))
const reportFiles = samplesMatching(new RegExp(`^Daily Report (${monthRe}) \\d{4}\\.xlsx$`))
const cashFile = samplesMatching(/^Cash Statement.*\.xlsx$/).at(-1)
if (!scheduleFiles.length || !cashFile) {
  console.error('Need at least one schedule export and a cash statement in samples/.')
  process.exit(2)
}

function readSchedule(file: string): Booking[] {
  const wb = read(readFileSync(file), { type: 'buffer', cellDates: true })
  const bookings: Booking[] = []
  for (const tab of wb.SheetNames) {
    if (tab.trim().toLowerCase() === 'contacts') continue
    const rows = utils.sheet_to_json<unknown[]>(wb.Sheets[tab], { header: 1, blankrows: true, raw: true, defval: null })
    const date = toISODate(rows[0]?.[8])
    if (!date) continue
    const therapists = [1, 3, 5].map((c) => String(rows[2]?.[c] ?? '').trim())
    for (let r = 3; r <= 32; r++) {
      const slot = String(rows[r]?.[0] ?? '').trim()
      ;[1, 3, 5].forEach((c, t) => {
        const cell = parseScheduleCell(rows[r]?.[c])
        if (cell.kind === 'bookings') for (const b of cell.bookings) bookings.push({ ...b, date, slot, therapist: therapists[t] })
      })
    }
  }
  return bookings
}

const latestSchedule: WorkBook = read(readFileSync(scheduleFiles.at(-1)!), { type: 'buffer' })
const contacts = parseContacts(latestSchedule).contacts
const bookings = scheduleFiles.flatMap(readSchedule)
const reportRows: OldReportRow[] = reportFiles.flatMap((f) => {
  const year = Number(/(\d{4})\.xlsx$/.exec(f)![1])
  return parseOldDailyReports(read(readFileSync(f), { type: 'buffer' }), year).flatMap((d) => d.rows)
})
const lastReportDate = reportRows.map((r) => r.date).sort().at(-1) ?? '0000-00-00'
const firstDataDate = [...reportRows.map((r) => r.date), ...bookings.map((b) => b.date)].sort()[0]

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

type Proposal = {
  clientId: string
  clientName: string
  cashName: string
  sessionsTotal: number
  priceTotal: number
  purchasedOn: string
  voucher: string | null
  used: number
  usedKnown: boolean
  notes: string[]
}

type Plan = {
  proposals: Proposal[]
  finished: Array<{ name: string; detail: string }>
  dormant: Array<{ name: string; detail: string }>
  unmatchedPayers: Array<{ name: string; detail: string; active: boolean }>
  ambiguous: Array<{ name: string; detail: string }>
  packageWithoutPurchase: Array<{ name: string; detail: string }>
  insurance: Array<{ name: string; detail: string }>
}

function buildPlan(
  match: (raw: string) => NameMatch,
  nameOf: (id: string) => string,
  cash: CashRow[],
  candidates: Array<{ id: string; name: string }>,
): Plan {
  const closest = (raw: string) => {
    let best = { name: '', score: 0 }
    for (const c of candidates) {
      const score = tokenSortRatio(raw, c.name)
      if (score > best.score) best = { name: c.name, score }
    }
    return best.score >= 0.6 ? `; closest client: "${best.name}" (${Math.round(best.score * 100)}%)` : '; no close client'
  }
  const plan: Plan = { proposals: [], finished: [], dormant: [], unmatchedPayers: [], ambiguous: [], packageWithoutPurchase: [], insurance: [] }
  const idFor = (raw: string) => {
    const m = match(raw)
    return m.kind === 'none' ? null : m.id
  }

  // Package events per client: report rows marked Package, then confirmed
  // schedule bookings after the last report (up to --until).
  const events = new Map<string, Array<{ date: string; source: 'report' | 'schedule' }>>()
  const push = (id: string, e: { date: string; source: 'report' | 'schedule' }) => events.set(id, [...(events.get(id) ?? []), e])
  for (const r of reportRows) {
    const id = idFor(r.name)
    if (id && r.info === 'package' && r.date <= until) push(id, { date: r.date, source: 'report' })
  }
  const confirmedAfterReports = bookings.filter((b) => b.status === 'confirmed' && b.date > lastReportDate && b.date <= until)
  const bookingsById = new Map<string, Booking[]>()
  for (const b of bookings) {
    const id = idFor(b.name)
    if (id) bookingsById.set(id, [...(bookingsById.get(id) ?? []), b])
  }

  // Purchases: "Package of N" rows, plus instalments ("last payment of the package").
  const packageRows = cash.filter((r) => r.kind === 'package')
  const byClient = new Map<string, CashRow[]>()
  const unmatched = new Map<string, CashRow[]>()
  for (const r of packageRows) {
    const m = match(r.nameRaw)
    if (m.kind === 'none') {
      const key = normalizeName(r.nameRaw)
      unmatched.set(key, [...(unmatched.get(key) ?? []), r])
      continue
    }
    if (m.kind === 'fuzzy' && m.ambiguousWith) {
      plan.ambiguous.push({ name: r.nameRaw, detail: `matches "${nameOf(m.id)}" or "${nameOf(m.ambiguousWith)}"; ${r.date} "${r.description}"` })
      continue
    }
    byClient.set(m.id, [...(byClient.get(m.id) ?? []), r])
  }

  // Payers not among the clients: is the person still coming in? Compare with
  // the names on the schedule and in the reports (they may be missing from Contacts).
  const recentNames = [...bookings.map((b) => b.name), ...reportRows.map((r) => r.name)].map(normalizeName)
  for (const [key, rows] of unmatched) {
    const latest = rows.sort((a, b) => a.date.localeCompare(b.date)).at(-1)!
    const seen = recentNames.filter((n) => n === key || tokenSortRatio(n, key) >= 0.85).length
    const detail = `latest: ${latest.date} ${latest.voucher ?? ''} "${latest.description}" $${amountReceived(latest)}${rows.length > 1 ? ` (${rows.length} package payments in all)` : ''}; ${seen ? `**${seen} booking(s)/report row(s) since ${firstDataDate}**` : 'not seen since ' + firstDataDate}${closest(latest.nameRaw)}`
    plan.unmatchedPayers.push({ name: latest.nameRaw, detail, active: seen > 0 })
  }

  for (const [clientId, rows] of byClient) {
    const purchases = rows.filter((r) => r.packageSessions).sort((a, b) => a.date.localeCompare(b.date))
    const latest = purchases.at(-1)
    if (!latest) continue // only instalment rows; reported below via packageWithoutPurchase if used
    const N = latest.packageSessions!
    const instalments = rows.filter(
      (r) => r !== latest && !r.packageSessions && r.date >= latest.date && daysBetween(latest.date, r.date) <= INSTALMENT_WINDOW_DAYS,
    )
    const notes: string[] = []
    let price = amountReceived(latest)
    if (instalments.length) {
      price += instalments.reduce((s, r) => s + amountReceived(r), 0)
      notes.push(`price includes ${instalments.length} later payment(s): ${instalments.map((r) => `${r.voucher ?? r.date} $${amountReceived(r)}`).join(', ')}`)
    }
    if (/first payment|1st payment/i.test(latest.description) && !instalments.length) notes.push('only a first payment was found; check the price')
    if (/paid by/i.test(latest.description)) notes.push(`"${latest.description}" (someone else paid)`)
    if (latest.method !== 'cash') notes.push(`paid by ${latest.method === 'pos' ? 'card/POS' : 'transfer'}`)

    const evs = (events.get(clientId) ?? []).filter((e) => e.date >= latest.date)
    for (const b of confirmedAfterReports) if (idFor(b.name) === clientId && b.date >= latest.date) evs.push({ date: b.date, source: 'schedule' })
    evs.sort((a, b) => a.date.localeCompare(b.date))

    // Anchor: the latest session number written on the schedule since the purchase.
    const anchor = (bookingsById.get(clientId) ?? [])
      .filter((b) => b.status === 'confirmed' && b.sessionNo && b.sessionNo <= N && b.date >= latest.date && b.date <= until)
      .sort((a, b) => a.date.localeCompare(b.date))
      .at(-1)
    const counted = evs.length
    let used: number
    let usedKnown = true
    if (anchor) {
      const after = evs.filter((e) => e.date > anchor.date).length
      used = anchor.sessionNo! + after
      notes.push(`schedule shows session ${anchor.sessionNo} on ${anchor.date}${after ? `, plus ${after} after` : ''}`)
      if (latest.date >= firstDataDate && counted !== used) notes.push(`counting the files instead gives ${counted}; check`)
    } else if (latest.date >= firstDataDate) {
      used = counted
      notes.push(`${counted} package session(s) counted since purchase`)
    } else {
      used = counted
      usedKnown = false
      notes.push(`bought ${latest.date}, before the files start (${firstDataDate}); at least ${counted} used since then`)
    }
    if (evs.some((e) => e.source === 'schedule')) notes.push(`sessions after ${lastReportDate} are from the schedule's C (confirmed) marks`)

    const detail = `package of ${N} bought ${latest.date} (${latest.voucher ?? 'no voucher'}), ${used} used`
    if (used >= N) {
      plan.finished.push({ name: nameOf(clientId), detail })
      continue
    }
    if (!usedKnown && counted === 0) {
      plan.dormant.push({ name: nameOf(clientId), detail: `${detail}; no package sessions since ${firstDataDate}` })
      continue
    }
    plan.proposals.push({
      clientId,
      clientName: nameOf(clientId),
      cashName: latest.nameRaw,
      sessionsTotal: N,
      priceTotal: price,
      purchasedOn: latest.date,
      voucher: latest.voucher,
      used: Math.min(used, N),
      usedKnown,
      notes,
    })
  }

  // Clients billed as Package in the reports with no purchase found.
  const proposedIds = new Set([...plan.proposals.map((p) => p.clientId), ...byClient.keys()])
  const onPackage = new Map<string, OldReportRow[]>()
  for (const r of reportRows) {
    if (r.info !== 'package') continue
    const id = idFor(r.name) ?? `?${normalizeName(r.name)}`
    if (!proposedIds.has(id)) onPackage.set(id, [...(onPackage.get(id) ?? []), r])
  }
  for (const [id, rows] of onPackage) {
    const maxNo = (bookingsById.get(id) ?? []).reduce((m, b) => Math.max(m, b.sessionNo ?? 0), 0)
    plan.packageWithoutPurchase.push({
      name: id.startsWith('?') ? `${rows[0].name} (not in Contacts)` : nameOf(id),
      detail: `${rows.length} package session(s) in the reports, last ${rows.at(-1)!.date}${maxNo ? `; highest session no. on the schedule: ${maxNo}` : ''}`,
    })
  }

  // Insurance clients, to enter by hand.
  const ins = new Map<string, OldReportRow[]>()
  for (const r of reportRows) {
    if (r.info !== 'insurance') continue
    const id = idFor(r.name) ?? `?${normalizeName(r.name)}`
    ins.set(id, [...(ins.get(id) ?? []), r])
  }
  for (const [id, rows] of ins) {
    const later = confirmedAfterReports.filter((b) => !id.startsWith('?') && idFor(b.name) === id).length
    const billed = [...new Set(rows.map((r) => r.billed).filter((b) => b !== null))].join('/')
    const paid = [...new Set(rows.map((r) => r.paid).filter((b) => b !== null))].join('/')
    const maxNo = (bookingsById.get(id) ?? []).reduce((m, b) => Math.max(m, b.sessionNo ?? 0), 0)
    plan.insurance.push({
      name: id.startsWith('?') ? `${rows[0].name} (not in Contacts)` : nameOf(id),
      detail: `${rows.length} insurance session(s) ${rows[0].date}…${rows.at(-1)!.date}, billed ${billed || '?'}, client paid ${paid || '0'}${later ? `; ${later} more confirmed on the schedule to ${until}` : ''}${maxNo ? `; highest session no.: ${maxNo}` : ''}`,
    })
  }
  for (const list of Object.values(plan)) (list as Array<{ name?: string; clientName?: string }>).sort((a, b) => String(a.name ?? a.clientName).localeCompare(String(b.name ?? b.clientName)))
  return plan
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function writeReport(plan: Plan) {
  const lines = [
    '# Go-live seed report',
    '',
    `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}. Sessions counted up to **${until}**.`,
    `Files: ${[cashFile!, ...reportFiles, ...scheduleFiles].map((f) => f.replace(`${SAMPLES}/`, '')).join(', ')}.`,
    `Daily reports run to ${lastReportDate}; after that, sessions come from the schedule's C marks.`,
    '',
    `## Packages to propose (${plan.proposals.length})`,
    '',
    'These are inserted as **To review**. She accepts, edits or discards each one on the Today screen.',
    '',
    ...plan.proposals.map(
      (p) =>
        `- **${p.clientName}**${normalizeName(p.cashName) !== normalizeName(p.clientName) ? ` (cash: "${p.cashName}")` : ''}: ${p.sessionsTotal} sessions, $${p.priceTotal}, bought ${p.purchasedOn} ${p.voucher ?? ''}; **${p.used} used**${p.usedKnown ? '' : ' (at least)'}, ${p.sessionsTotal - p.used} left. ${p.notes.join('; ')}.`,
    ),
    '',
    section('Insurance clients to enter by hand', plan.insurance, 'Serial numbers are in no file, so approvals are not seeded.'),
    section('Billed as Package, but no purchase found in the cash statement', plan.packageWithoutPurchase, 'Probably bought before January or recorded differently. Add these by hand if still open.'),
    section(
      'Package payers not found among clients, still coming in',
      plan.unmatchedPayers.filter((p) => p.active),
      'Not in Contacts under this name. Add the client in the app (Clients → Add), or add the cash name as a name variant, then run the seed again.',
    ),
    section('Package payers not found among clients, not seen recently', plan.unmatchedPayers.filter((p) => !p.active), 'Probably finished; nothing to do unless one is still open.'),
    section('Ambiguous names (two clients match)', plan.ambiguous),
    section('Latest package looks finished (not proposed)', plan.finished),
    section('Bought before the files start and not seen since (not proposed)', plan.dormant),
  ]
  writeFileSync(join(SAMPLES, 'seed-report.md'), lines.join('\n'))
}

function section(title: string, items: Array<{ name: string; detail: string }>, intro?: string): string {
  return [`## ${title} (${items.length})`, '', ...(intro ? [intro, ''] : []), ...items.map((i) => `- **${i.name}**: ${i.detail}`), ''].join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const password = process.env.SAMPLE_CASH_PASSWORD || (await promptHidden('Cash statement password: '))
  const cash = parseCashStatement(read(await decryptOfficeFile(new Uint8Array(readFileSync(cashFile!)), password), { type: 'array', cellDates: true }), {
    insurers: ['nextcare'],
  }).rows

  if (!apply) {
    // Dry run: match against the Contacts tab, which is what she imports.
    const names = new Map(contacts.map((c) => [c.key, c.name]))
    const candidates = contacts.map((c) => ({ id: c.key, name: c.name }))
    const plan = buildPlan(createNameMatcher(candidates), (id) => names.get(id) ?? id, cash, candidates)
    writeReport(plan)
    summary(plan)
    console.log('\nDry run only. Full report (with names): samples/seed-report.md')
    console.log('To insert the proposals: npm run seed -- --apply')
    rl.close()
    return
  }

  const url = process.env.VITE_SUPABASE_URL!
  const db = createClient<Database>(url, process.env.VITE_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
  const email = process.env.SEED_EMAIL || (await rl.question('Her login email: '))
  rl.close()
  const { error: loginError } = await db.auth.signInWithPassword({ email: email.trim(), password: await promptHidden('Her password: ') })
  if (loginError) {
    console.error(`Sign-in failed: ${loginError.message}`)
    process.exit(1)
  }

  const clients: Array<{ id: string; name: string }> = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('clients').select('id, name').range(from, from + 999)
    if (error) throw error
    clients.push(...data)
    if (data.length < 1000) break
  }
  if (!clients.length) {
    console.error('No clients in the app yet. Import them first (More → Import clients), then run this again.')
    process.exit(1)
  }
  const { data: aliasRows, error: aliasError } = await db.from('client_aliases').select('alias, client_id')
  if (aliasError) throw aliasError
  const names = new Map(clients.map((c) => [c.id, c.name]))
  const matcher = createNameMatcher(clients, new Map(aliasRows.map((a) => [a.alias, a.client_id])))
  const plan = buildPlan(matcher, (id) => names.get(id) ?? id, cash, clients)
  writeReport(plan)

  const { data: existing, error: existingError } = await db.from('packages').select('client_id, purchased_on, sessions_total')
  if (existingError) throw existingError
  const have = new Set(existing.map((p) => `${p.client_id}|${p.purchased_on}|${p.sessions_total}`))
  const rows = plan.proposals
    .filter((p) => !have.has(`${p.clientId}|${p.purchasedOn}|${p.sessionsTotal}`))
    .map((p) => ({
      client_id: p.clientId,
      sessions_total: p.sessionsTotal,
      price_total: p.priceTotal,
      per_session: Math.round(p.priceTotal / p.sessionsTotal),
      purchased_on: p.purchasedOn,
      source_voucher: p.voucher,
      sessions_used_before_app: p.used,
      used_before_app_as_of: until,
      status: 'proposed',
      notes: `Go-live seed: ${p.notes.join('; ')}.`,
    }))
  if (rows.length) {
    const { error } = await db.from('packages').insert(rows)
    if (error) throw error
  }
  summary(plan)
  console.log(`\nInserted ${rows.length} proposed package(s); ${plan.proposals.length - rows.length} were already there.`)
  console.log('Full report: samples/seed-report.md')
  await db.auth.signOut()
}

function summary(plan: Plan) {
  console.log(`Sessions counted up to ${until} (daily reports to ${lastReportDate}, schedule after).`)
  console.log(`Packages to propose:            ${plan.proposals.length} (${plan.proposals.filter((p) => !p.usedKnown).length} with an uncertain count)`)
  console.log(`Insurance clients to enter:     ${plan.insurance.length}`)
  console.log(`On package, no purchase found:  ${plan.packageWithoutPurchase.length}`)
  console.log(`Package payers not matched:     ${plan.unmatchedPayers.length} people (${plan.unmatchedPayers.filter((p) => p.active).length} still coming in)`)
  console.log(`Ambiguous names:                ${plan.ambiguous.length}`)
  console.log(`Latest package finished:        ${plan.finished.length}`)
  console.log(`Old and not seen since:         ${plan.dormant.length}`)
}

async function promptHidden(question: string): Promise<string> {
  process.stdout.write(question)
  const stdin = process.stdin
  if (!stdin.isTTY) throw new Error('Run this in a terminal so the password can be typed.')
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding('utf8')
  return new Promise((resolve) => {
    let value = ''
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.off('data', onData)
          process.stdout.write('\n')
          return resolve(value)
        }
        if (ch === '\u0003') process.exit(130)
        value = ch === '\u007f' ? value.slice(0, -1) : value + ch
      }
    }
    stdin.on('data', onData)
  })
}

function yesterday(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
