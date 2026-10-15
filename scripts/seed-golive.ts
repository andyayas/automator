// Go-live seed: proposes the packages that are still open, with sessions used
// so far, from the files in samples/. Local only, never deployed.
//
// Sources, most trusted first:
//   1. Her monthly "Statement of Account" (Package Sessions table): her own
//      count of sessions remaining at the end of the month.
//   2. Session numbers written on the schedule ("Name 9 C").
//   3. Counting package rows in the daily reports, then the schedule's C marks.
//
//   npm run seed                       dry run: writes samples/seed-report.md
//   npm run seed -- --until=2026-10-14 count sessions up to this date (default: yesterday)
//   npm run seed -- --apply            signs in as her and inserts the proposals
//
// Everything it inserts is `proposed`: it counts for nothing until she accepts
// it on the Today screen. Insurance approvals are not seeded (serial numbers
// are in no file); the report lists the insurance clients to enter by hand.
// The report contains real names and stays in samples/ (gitignored).

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { createClient } from '@supabase/supabase-js'
import { read, utils, type WorkBook } from 'xlsx'
import type { Database } from '../src/lib/database.types.ts'
import { amountReceived, parseCashStatement, toISODate, type CashRow } from '../src/lib/cash-statement.ts'
import { parseContacts } from '../src/lib/contacts.ts'
import { createNameMatcher, displayName, FUZZY_THRESHOLD, normalizeName, tokenSortRatio, type NameMatch } from '../src/lib/names.ts'
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

type StatementRow = { name: string; size: number; remaining: number; asOf: string; file: string }

/** "Package Sessions" table of her monthly statement: Client, Package, Used in <month>, Remaining. */
function readStatement(file: string): StatementRow[] {
  const wb = read(readFileSync(file), { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true, raw: true, defval: null })
  const period = rows.flat().map(String).find((v) => /^period:/i.test(v)) ?? ''
  const m = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*$/.exec(period)
  const month = m ? MONTHS.findIndex((x) => x.toLowerCase().startsWith(m[2].toLowerCase().slice(0, 3))) : -1
  if (!m || month < 0) {
    console.warn(`Skipping ${file}: no "Period: … <day> <Month> <year>" line found.`)
    return []
  }
  const asOf = `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`
  const start = rows.findIndex((r) => String(r[0] ?? '').trim().toLowerCase() === 'package sessions')
  if (start < 0) return []
  const out: StatementRow[] = []
  for (let i = start + 2; i < rows.length; i++) {
    const [name, size, , , remaining] = [rows[i][0], rows[i][1], rows[i][2], rows[i][3], rows[i][4]]
    if (!name || String(name).trim().toUpperCase() === 'TOTAL') break
    if (typeof size === 'number' && typeof remaining === 'number') out.push({ name: String(name).trim(), size, remaining, asOf, file })
  }
  return out
}

const latestSchedule: WorkBook = read(readFileSync(scheduleFiles.at(-1)!), { type: 'buffer' })
const contacts = parseContacts(latestSchedule).contacts
const bookings = scheduleFiles.flatMap(readSchedule)
const reportRows: OldReportRow[] = reportFiles.flatMap((f) => {
  const year = Number(/(\d{4})\.xlsx$/.exec(f)![1])
  return parseOldDailyReports(read(readFileSync(f), { type: 'buffer' }), year).flatMap((d) => d.rows)
})
// Her answers about names (samples/seed-decisions.json, gitignored):
//   link:   spelling -> existing client name (the same person)
//   rename: existing client name -> correct name
//   same:   groups of spellings that are one new client (first is the name used)
//   new:    names she confirmed are new clients. Only these are created.
type Decisions = { link: Record<string, string>; rename: Record<string, string>; same: string[][]; new: string[] }
const decisionsFile = join(SAMPLES, 'seed-decisions.json')
const decisions: Decisions = {
  link: {},
  rename: {},
  same: [],
  new: [],
  ...(existsSync(decisionsFile) ? (JSON.parse(readFileSync(decisionsFile, 'utf8')) as Partial<Decisions>) : {}),
}

/** Adds her "link" decisions to the alias map, resolving each target to a client id. */
function withLinks(candidates: Array<{ id: string; name: string }>, aliases: Map<string, string> = new Map()) {
  const byName = new Map(candidates.map((c) => [normalizeName(c.name), c.id]))
  const out = new Map(aliases)
  const missing: string[] = []
  for (const [spelling, target] of Object.entries(decisions.link)) {
    const id = byName.get(normalizeName(target)) ?? aliases.get(normalizeName(target))
    if (id) out.set(normalizeName(spelling), id)
    else missing.push(`"${spelling}" → "${target}" (no client called "${target}")`)
  }
  return { aliases: out, missing }
}

const statementFiles = samplesMatching(/^Statement of Account .*\.xlsx$/)
const statementRows = statementFiles.flatMap(readStatement)
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
  purchasedOn: string | null
  voucher: string | null
  used: number
  usedKnown: boolean
  fromStatement: boolean
  notes: string[]
}

type NewClient = { id: string; name: string; spellings: Set<string>; sources: Set<string>; closest: string; confirmed: boolean }

type Plan = {
  newClients: NewClient[]
  linkProblems: string[]
  proposals: Proposal[]
  finished: Array<{ name: string; detail: string }>
  overused: Array<{ name: string; detail: string }>
  dormant: Array<{ name: string; detail: string }>
  unmatchedPayers: Array<{ name: string; detail: string; active: boolean }>
  ambiguous: Array<{ name: string; detail: string }>
  packageWithoutPurchase: Array<{ name: string; detail: string }>
  unmatchedStatement: Array<{ name: string; detail: string }>
  insurance: Array<{ name: string; detail: string }>
}

function buildPlan(
  matchExisting: (raw: string) => NameMatch,
  nameOfExisting: (id: string) => string,
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
  const plan: Plan = {
    newClients: [],
    linkProblems: [],
    proposals: [],
    finished: [],
    overused: [],
    dormant: [],
    unmatchedPayers: [],
    ambiguous: [],
    packageWithoutPurchase: [],
    unmatchedStatement: [],
    insurance: [],
  }

  // New clients. Contacts is an old export of the clinic phone, so many real
  // clients aren't in it. Anyone in her statement, the daily reports or a recent
  // package payment who matches no client becomes a new client (no phone yet).
  // Spellings of the same person across files are merged into one, and a
  // near-miss is never merged into an existing client: the report shows the
  // closest existing name so it can be linked by hand before --apply.
  const pending = new Map<string, NewClient>()
  let matchPending = createNameMatcher([])
  // Her "same person" groups: every spelling resolves to the group's first name.
  const canonical = new Map<string, string>()
  for (const group of decisions.same) for (const n of group) canonical.set(normalizeName(n), group[0])
  const toCanonical = (raw: string) => canonical.get(normalizeName(raw)) ?? raw
  const confirmed = new Set(decisions.new.map(normalizeName))
  const recentNames = [...bookings.map((b) => b.name), ...reportRows.map((r) => r.name)].map(normalizeName)
  const addPending = (raw: string, source: string) => {
    const name = raw.replace(/\s+/g, ' ').trim()
    if (!normalizeName(name) || matchExisting(name).kind !== 'none') return
    const p = matchPending(toCanonical(name))
    if (p.kind !== 'none') {
      const c = pending.get(p.id)!
      c.spellings.add(name)
      c.sources.add(source)
      return
    }
    const id = `new:${pending.size + 1}`
    const display = displayName(toCanonical(name))
    pending.set(id, {
      id,
      name: display,
      spellings: new Set([name]),
      sources: new Set([source]),
      closest: closest(name),
      confirmed: false,
    })
    matchPending = createNameMatcher([...pending.values()].map((c) => ({ id: c.id, name: c.name })))
  }
  for (const t of statementRows) if (t.remaining > 0) addPending(t.name, 'her statement')
  for (const r of reportRows) if (r.info === 'package' || r.info === 'insurance') addPending(r.name, `daily reports (${r.info})`)
  for (const r of cash) {
    if (r.kind !== 'package') continue
    const key = normalizeName(r.nameRaw)
    const recent = r.date >= firstDataDate || recentNames.some((n) => n === key || tokenSortRatio(n, key) >= FUZZY_THRESHOLD)
    if (recent) addPending(r.nameRaw, 'cash statement (package)')
  }
  for (const c of pending.values()) {
    c.confirmed = confirmed.has(normalizeName(c.name)) || [...c.spellings].some((x) => confirmed.has(normalizeName(x)))
  }
  plan.newClients = [...pending.values()]

  // From here on, names resolve to existing clients first, then new ones.
  const match = (raw: string): NameMatch => {
    const m = matchExisting(raw)
    return m.kind === 'none' ? matchPending(toCanonical(raw)) : m
  }
  const nameOf = (id: string) => (id.startsWith('new:') ? `${pending.get(id)!.name} (new client)` : nameOfExisting(id))
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
  const cashLastDate = cash.map((r) => r.date).sort().at(-1) ?? '?'
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
  for (const [key, rows] of unmatched) {
    const latest = rows.sort((a, b) => a.date.localeCompare(b.date)).at(-1)!
    const seen = recentNames.filter((n) => n === key || tokenSortRatio(n, key) >= 0.85).length
    const detail = `latest: ${latest.date} ${latest.voucher ?? ''} "${latest.description}" $${amountReceived(latest)}${rows.length > 1 ? ` (${rows.length} package payments in all)` : ''}; ${seen ? `**${seen} booking(s)/report row(s) since ${firstDataDate}**` : 'not seen since ' + firstDataDate}${closest(latest.nameRaw)}`
    plan.unmatchedPayers.push({ name: latest.nameRaw, detail, active: seen > 0 })
  }

  /** Package sessions for a client after a date (exclusive), up to --until. */
  const sessionsAfter = (clientId: string, after: string) => {
    const evs = (events.get(clientId) ?? []).filter((e) => e.date > after)
    for (const b of confirmedAfterReports) if (b.date > after && idFor(b.name) === clientId) evs.push({ date: b.date, source: 'schedule' })
    return evs.sort((a, b) => a.date.localeCompare(b.date))
  }

  /** Sessions used on a purchase, worked out from the files alone. */
  const fromFiles = (clientId: string, purchase: CashRow) => {
    const N = purchase.packageSessions!
    const dayBefore = addDays(purchase.date, -1)
    const evs = sessionsAfter(clientId, dayBefore)
    const anchor = (bookingsById.get(clientId) ?? [])
      .filter((b) => b.status === 'confirmed' && b.sessionNo && b.sessionNo <= N && b.date >= purchase.date && b.date <= until)
      .sort((a, b) => a.date.localeCompare(b.date))
      .at(-1)
    const notes: string[] = []
    let used: number
    let usedKnown = true
    if (anchor) {
      const after = evs.filter((e) => e.date > anchor.date).length
      used = anchor.sessionNo! + after
      notes.push(`schedule shows session ${anchor.sessionNo} on ${anchor.date}${after ? `, plus ${after} after` : ''}`)
      if (purchase.date >= firstDataDate && evs.length !== used) notes.push(`counting the files instead gives ${evs.length}; check`)
    } else if (purchase.date >= firstDataDate) {
      used = evs.length
      notes.push(`${evs.length} package session(s) counted since purchase`)
    } else {
      used = evs.length
      usedKnown = false
      notes.push(`bought ${purchase.date}, before the files start (${firstDataDate}); at least ${evs.length} used since then`)
    }
    if (evs.some((e) => e.source === 'schedule')) notes.push(`sessions after ${lastReportDate} are from the schedule's C (confirmed) marks`)
    return { used, usedKnown, counted: evs.length, notes }
  }

  /** Price of a purchase, including later instalments. */
  const priceOf = (purchase: CashRow, rows: CashRow[]) => {
    const instalments = rows.filter(
      (r) => r !== purchase && !r.packageSessions && r.date >= purchase.date && daysBetween(purchase.date, r.date) <= INSTALMENT_WINDOW_DAYS,
    )
    const notes: string[] = []
    let price = amountReceived(purchase)
    if (instalments.length) {
      price += instalments.reduce((sum, r) => sum + amountReceived(r), 0)
      notes.push(`price includes ${instalments.length} later payment(s): ${instalments.map((r) => `${r.voucher ?? r.date} $${amountReceived(r)}`).join(', ')}`)
    }
    if (/first payment|1st payment/i.test(purchase.description) && !instalments.length) notes.push('only a first payment was found; check the price')
    if (/paid by/i.test(purchase.description)) notes.push(`"${purchase.description}" (someone else paid)`)
    if (purchase.method !== 'cash') notes.push(`paid by ${purchase.method === 'pos' ? 'card/POS' : 'transfer'}`)
    return { price, notes }
  }

  /** Usual billed value per package session for a client in the reports (fallback 38). */
  const usualRate = (clientId: string) => {
    const counts = new Map<number, number>()
    for (const r of reportRows) if (r.info === 'package' && r.billed && idFor(r.name) === clientId) counts.set(r.billed, (counts.get(r.billed) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 38
  }

  // Her statement, matched to clients (latest statement per client wins).
  const statementById = new Map<string, StatementRow>()
  for (const t of statementRows) {
    const m = match(t.name)
    if (m.kind === 'none' || (m.kind === 'fuzzy' && m.ambiguousWith)) {
      plan.unmatchedStatement.push({
        name: t.name,
        detail: `${t.remaining} of ${t.size} left on ${t.asOf}${m.kind === 'fuzzy' ? `; matches "${nameOf(m.id)}" or "${nameOf(m.ambiguousWith!)}"` : closest(t.name)}`,
      })
      continue
    }
    const prev = statementById.get(m.id)
    if (!prev || prev.asOf < t.asOf) statementById.set(m.id, t)
  }

  const handled = new Set<string>()
  const finish = (clientId: string, detail: string) => plan.finished.push({ name: nameOf(clientId), detail })

  // 1. Her own count: remaining at the end of the statement month, plus sessions since.
  for (const [clientId, t] of statementById) {
    const purchases = (byClient.get(clientId) ?? []).filter((r) => r.packageSessions).sort((a, b) => a.date.localeCompare(b.date))
    const latest = purchases.at(-1)
    if (latest && latest.date > t.asOf) continue // a newer package was bought after her statement: handled from the files below
    handled.add(clientId)
    const since = sessionsAfter(clientId, t.asOf)
    const used = t.size - t.remaining + since.length
    const notes = [`her statement: ${t.remaining} of ${t.size} left on ${t.asOf}`]
    if (since.length) notes.push(`${since.length} package session(s) since (${[...new Set(since.map((e) => (e.source === 'report' ? 'daily reports' : "schedule's C marks")))].join(' + ')})`)

    let price: number
    if (latest && latest.packageSessions === t.size) {
      const p = priceOf(latest, byClient.get(clientId)!)
      price = p.price
      notes.push(...p.notes)
      const files = fromFiles(clientId, latest)
      if (files.usedKnown && files.used !== used) notes.push(`the files alone suggest ${files.used} used; her count is used`)
    } else {
      const rate = usualRate(clientId)
      price = rate * t.size
      notes.push(`no matching purchase in the cash statement; price estimated as ${t.size} × $${rate}, check it`)
    }

    const detail = `package of ${t.size}, ${t.remaining} left on ${t.asOf} (her statement)${since.length ? `, ${since.length} since` : ''}`
    if (used > t.size) {
      plan.overused.push({
        name: nameOf(clientId),
        detail: `${detail}: **${used - t.size} more than were left**. Probably a new package bought after ${cashLastDate} (the end of the cash statement), or sessions owed. Sessions since: ${since.map((e) => e.date.slice(5)).join(', ')}`,
      })
      continue
    }
    if (used >= t.size) {
      finish(clientId, detail)
      continue
    }
    plan.proposals.push({
      clientId,
      clientName: nameOf(clientId),
      cashName: latest?.nameRaw ?? t.name,
      sessionsTotal: t.size,
      priceTotal: price,
      purchasedOn: latest && latest.packageSessions === t.size ? latest.date : null,
      voucher: latest && latest.packageSessions === t.size ? latest.voucher : null,
      used,
      usedKnown: true,
      fromStatement: true,
      notes,
    })
  }

  // 2. Everyone else: from the cash statement purchase and the files.
  for (const [clientId, rows] of byClient) {
    if (handled.has(clientId)) continue
    const latest = rows.filter((r) => r.packageSessions).sort((a, b) => a.date.localeCompare(b.date)).at(-1)
    if (!latest) continue // only instalment rows; reported below via packageWithoutPurchase if used
    handled.add(clientId)
    const N = latest.packageSessions!
    const { price, notes: priceNotes } = priceOf(latest, rows)
    const files = fromFiles(clientId, latest)
    const notes = [...priceNotes, ...files.notes]
    const t = statementById.get(clientId)
    if (t) notes.push(`her statement (${t.asOf}) covered an earlier package`)

    const detail = `package of ${N} bought ${latest.date} (${latest.voucher ?? 'no voucher'}), ${files.used} used`
    if (files.used > N) {
      plan.overused.push({ name: nameOf(clientId), detail: `${detail}: **${files.used - N} more than the package has**. Probably a newer package not in the cash statement (it ends ${cashLastDate}), or sessions owed. ${files.notes.join('; ')}` })
      continue
    }
    if (files.used >= N) {
      finish(clientId, detail)
      continue
    }
    if (!files.usedKnown && files.counted === 0) {
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
      used: Math.min(files.used, N),
      usedKnown: files.usedKnown,
      fromStatement: false,
      notes,
    })
  }

  // Clients billed as Package in the reports with no purchase found.
  const proposedIds = new Set([...handled, ...byClient.keys()])
  const onPackage = new Map<string, OldReportRow[]>()
  for (const r of reportRows) {
    if (r.info !== 'package') continue
    const id = idFor(r.name) ?? `?${normalizeName(r.name)}`
    if (!proposedIds.has(id)) onPackage.set(id, [...(onPackage.get(id) ?? []), r])
  }
  for (const [id, rows] of onPackage) {
    const maxNo = (bookingsById.get(id) ?? []).reduce((m, b) => Math.max(m, b.sessionNo ?? 0), 0)
    plan.packageWithoutPurchase.push({
      name: id.startsWith('?') ? `${rows[0].name} (no client)` : nameOf(id),
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
      name: id.startsWith('?') ? `${rows[0].name} (no client)` : nameOf(id),
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
    `Files: ${[cashFile!, ...statementFiles, ...reportFiles, ...scheduleFiles].map((f) => f.replace(`${SAMPLES}/`, '')).join(', ')}.`,
    statementFiles.length ? 'Where her Statement of Account lists a package, her count of sessions remaining is used.' : '',
    `Daily reports run to ${lastReportDate}; after that, sessions come from the schedule's C marks.`,
    '',
    ...(plan.linkProblems.length
      ? [`## Decisions that could not be applied (${plan.linkProblems.length})`, '', ...plan.linkProblems.map((x) => `- ${x}`), '']
      : []),
    `## New names waiting for your decision (${plan.newClients.filter((c) => !c.confirmed).length})`,
    '',
    'Not found among the clients and not in samples/seed-decisions.json yet. Nothing is created for them (and their',
    'packages are held back) until you add each one to "new", "link" or "same" in that file.',
    '',
    ...plan.newClients.filter((c) => !c.confirmed).map(newClientLine),
    '',
    `## New clients you confirmed (${plan.newClients.filter((c) => c.confirmed).length})`,
    '',
    'Created on --apply with **no phone**; fill phones in later. Other spellings are saved as name variants.',
    '',
    ...plan.newClients.filter((c) => c.confirmed).map(newClientLine),
    '',
    `## Your other decisions`,
    '',
    ...Object.entries(decisions.link).map(([a, b]) => `- "${a}" is the existing client **${b}**`),
    ...Object.entries(decisions.rename).map(([a, b]) => `- Rename **${a}** to **${b}** (the old spelling stays as a name variant)`),
    ...decisions.same.map((g) => `- One client **${g[0]}** for: ${g.map((x) => `"${x}"`).join(', ')}`),
    '',
    `## Packages to propose (${plan.proposals.length})`,
    '',
    'These are inserted as **To review**. She accepts, edits or discards each one on the Today screen.',
    '',
    ...plan.proposals.map(
      (p) =>
        `- ${p.clientId.startsWith('new:') && !plan.newClients.find((c) => c.id === p.clientId)?.confirmed ? '⏸ held back until you decide on this name: ' : ''}**${p.clientName}**${normalizeName(p.cashName) !== normalizeName(p.clientName) ? ` ("${p.cashName}")` : ''}: ${p.sessionsTotal} sessions, $${p.priceTotal}, ${p.purchasedOn ? `bought ${p.purchasedOn} ${p.voucher ?? ''}` : 'purchase date unknown'}; **${p.used} used**${p.usedKnown ? '' : ' (at least)'}, ${p.sessionsTotal - p.used} left${p.fromStatement ? ' (her count)' : ''}. ${p.notes.join('; ')}.`,
    ),
    '',
    section('Insurance clients to enter by hand', plan.insurance, 'Serial numbers are in no file, so approvals are not seeded.'),
    section(
      'In her statement but not matched to a client',
      plan.unmatchedStatement,
      'Add the client or a name variant, then run the seed again. Those with sessions left matter most.',
    ),
    section('Billed as Package, but no purchase found in the cash statement', plan.packageWithoutPurchase, 'Probably bought before January or recorded differently. Add these by hand if still open.'),
    section(
      'Package payers not found among clients, still coming in',
      plan.unmatchedPayers.filter((p) => p.active),
      'Not in Contacts under this name. Add the client in the app (Clients → Add), or add the cash name as a name variant, then run the seed again.',
    ),
    section('Package payers not found among clients, not seen recently', plan.unmatchedPayers.filter((p) => !p.active), 'Probably finished; nothing to do unless one is still open.'),
    section('Ambiguous names (two clients match)', plan.ambiguous),
    section('Used more sessions than were left — check (not proposed)', plan.overused, 'She decides: add the newer package by hand, or note sessions owed.'),
    section('Latest package looks finished (not proposed)', plan.finished),
    section('Bought before the files start and not seen since (not proposed)', plan.dormant),
  ]
  writeFileSync(join(SAMPLES, 'seed-report.md'), lines.join('\n'))
}

function newClientLine(c: NewClient): string {
  return `- **${c.name}**: from ${[...c.sources].join(', ')}${c.spellings.size > 1 ? `; spellings: ${[...c.spellings].map((x) => `"${x}"`).join(', ')}` : ''}${c.closest}`
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
  const parsedCash = parseCashStatement(read(await decryptOfficeFile(new Uint8Array(readFileSync(cashFile!)), password), { type: 'array', cellDates: true }), {
    insurers: ['nextcare'],
  })
  const cash = parsedCash.rows
  for (const f of parsedCash.fixedDates) console.log(`Cash statement date corrected: ${f}`)

  if (!apply) {
    // Dry run: match against the Contacts tab, which is what she imports.
    const names = new Map(contacts.map((c) => [c.key, c.name]))
    const candidates = contacts.map((c) => ({ id: c.key, name: c.name }))
    const links = withLinks(candidates)
    const plan = buildPlan(createNameMatcher(candidates, links.aliases), (id) => names.get(id) ?? id, cash, candidates)
    plan.linkProblems = links.missing
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
  const links = withLinks(clients, new Map(aliasRows.map((a) => [a.alias, a.client_id])))
  const matcher = createNameMatcher(clients, links.aliases)
  const plan = buildPlan(matcher, (id) => names.get(id) ?? id, cash, clients)
  plan.linkProblems = links.missing
  writeReport(plan)

  // Her links become name variants in the app, so it knows them from now on.
  const linkAliases = Object.keys(decisions.link)
    .map((spelling) => ({ alias: normalizeName(spelling), client_id: links.aliases.get(normalizeName(spelling)) }))
    .filter((a): a is { alias: string; client_id: string } => Boolean(a.client_id))
  if (linkAliases.length) {
    const { error } = await db.from('client_aliases').upsert(linkAliases, { onConflict: 'owner_id,alias', ignoreDuplicates: true })
    if (error) throw error
  }

  // Renames she asked for; the old spelling stays as a name variant.
  let renamed = 0
  for (const [from, to] of Object.entries(decisions.rename)) {
    const id = clients.find((c) => normalizeName(c.name) === normalizeName(from))?.id
    if (!id) continue // already renamed on an earlier run
    const { error } = await db.from('clients').update({ name: to }).eq('id', id)
    if (error) throw error
    await db.from('client_aliases').upsert({ client_id: id, alias: normalizeName(from) }, { onConflict: 'owner_id,alias', ignoreDuplicates: true })
    renamed++
  }

  // Create the new clients (no phone), and keep their other spellings as name variants.
  const newIds = new Map<string, string>()
  for (const c of plan.newClients.filter((x) => x.confirmed)) {
    const { data, error } = await db
      .from('clients')
      .insert({ name: c.name, notes: 'Added by the go-live seed: not in the Contacts tab. Phone unknown.' })
      .select('id')
      .single()
    if (error) throw error
    newIds.set(c.id, data.id)
    const aliases = [...new Set([...c.spellings].map(normalizeName))].filter((a) => a && a !== normalizeName(c.name))
    if (aliases.length) {
      const { error: aliasErr } = await db
        .from('client_aliases')
        .upsert(aliases.map((alias) => ({ client_id: data.id, alias })), { onConflict: 'owner_id,alias', ignoreDuplicates: true })
      if (aliasErr) throw aliasErr
    }
  }
  // Packages of names she hasn't decided on yet are held back.
  plan.proposals = plan.proposals.filter((p) => !p.clientId.startsWith('new:') || newIds.has(p.clientId))
  for (const p of plan.proposals) if (p.clientId.startsWith('new:')) p.clientId = newIds.get(p.clientId)!

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
  console.log(`\nAdded ${newIds.size} new client(s) without a phone; renamed ${renamed}; saved ${linkAliases.length} linked spelling(s).`)
  console.log(`Inserted ${rows.length} proposed package(s); ${plan.proposals.length - rows.length} were already there.`)
  console.log('Full report: samples/seed-report.md')
  await db.auth.signOut()
}

function summary(plan: Plan) {
  console.log(`Sessions counted up to ${until} (daily reports to ${lastReportDate}, schedule after).`)
  console.log(`New clients you confirmed:      ${plan.newClients.filter((c) => c.confirmed).length}`)
  console.log(`New names waiting for decision: ${plan.newClients.filter((c) => !c.confirmed).length}`)
  if (plan.linkProblems.length) console.log(`Decisions that couldn't apply:  ${plan.linkProblems.length}`)
  console.log(`Packages to propose:            ${plan.proposals.length} (${plan.proposals.filter((p) => p.fromStatement).length} from her statement, ${plan.proposals.filter((p) => !p.usedKnown).length} with an uncertain count)`)
  console.log(`Statement rows not matched:     ${plan.unmatchedStatement.length}`)
  console.log(`Insurance clients to enter:     ${plan.insurance.length}`)
  console.log(`On package, no purchase found:  ${plan.packageWithoutPurchase.length}`)
  console.log(`Package payers not matched:     ${plan.unmatchedPayers.length} people (${plan.unmatchedPayers.filter((p) => p.active).length} still coming in)`)
  console.log(`Ambiguous names:                ${plan.ambiguous.length}`)
  console.log(`Used more than was left:        ${plan.overused.length}`)
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

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
