// Rebuilds the days her hand-made daily reports cover, from the schedule export
// and the cash statement, and compares: who came, what was collected, billing.
// Local only:  npm run compare:reports
// Prints counts only; details (real names) go to samples/report-comparison.md.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { read } from 'xlsx'
import type { ApprovalWithBalance, PackageWithBalance } from '../src/lib/api.ts'
import { parseCashStatement } from '../src/lib/cash-statement.ts'
import { parseContacts } from '../src/lib/contacts-xlsx.ts'
import { buildDayDraft, type BillingType, type CashInput, type EntryInput } from '../src/lib/day-builder.ts'
import { createNameMatcher, normalizeName } from '../src/lib/names.ts'
import { decryptOfficeFile } from '../src/lib/office-crypto.ts'
import { parseOldDailyReports, type OldReportRow } from '../src/lib/old-daily-report.ts'
import { parseScheduleGrids } from '../src/lib/schedule.ts'
import { sheetRows } from '../src/lib/sheet-rows.ts'

const SAMPLES = 'samples'
const files = (re: RegExp) =>
  readdirSync(SAMPLES)
    .filter((f) => re.test(f))
    .map((f) => join(SAMPLES, f))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December'

// --- Names: Contacts + her seed decisions, like the app after go-live ---------
const scheduleFiles = files(new RegExp(`^(${MONTHS}) \\d{4}\\.xlsx$`))
const contacts = parseContacts(read(readFileSync(scheduleFiles.at(-1)!), { type: 'buffer' })).contacts
type Decisions = { link?: Record<string, string>; same?: string[][]; new?: string[] }
const decisions: Decisions = existsSync(join(SAMPLES, 'seed-decisions.json'))
  ? JSON.parse(readFileSync(join(SAMPLES, 'seed-decisions.json'), 'utf8'))
  : {}
const candidates = [...contacts.map((c) => ({ id: c.key, name: c.name })), ...(decisions.new ?? []).map((n) => ({ id: normalizeName(n), name: n }))]
const aliases = new Map<string, string>()
for (const [spelling, target] of Object.entries(decisions.link ?? {})) aliases.set(normalizeName(spelling), normalizeName(target))
for (const group of decisions.same ?? []) for (const n of group) aliases.set(normalizeName(n), normalizeName(group[0]))
const match = createNameMatcher(candidates, aliases)
const idFor = (raw: string | null) => {
  const m = match(raw ?? '')
  return m.kind === 'none' || (m.kind === 'fuzzy' && m.ambiguousWith) ? null : m.id
}
const clientNames = new Map(candidates.map((c) => [c.id, c.name]))

// --- Sources ---------------------------------------------------------------
const reports: OldReportRow[] = files(new RegExp(`^Daily Report (${MONTHS}) \\d{4}\\.xlsx$`)).flatMap((f) =>
  parseOldDailyReports(read(readFileSync(f), { type: 'buffer' }), Number(/(\d{4})\.xlsx$/.exec(f)![1])).flatMap((d) => d.rows),
)
const days = scheduleFiles.flatMap((f) => {
  const wb = read(readFileSync(f), { type: 'buffer', cellDates: true })
  return parseScheduleGrids(wb.SheetNames.map((name) => ({ name, rows: sheetRows(wb.Sheets[name]) })))
})
const cashFile = files(/^Cash Statement.*\.xlsx$/).at(-1)!
const cashRows = parseCashStatement(
  read(await decryptOfficeFile(new Uint8Array(readFileSync(cashFile)), process.env.SAMPLE_CASH_PASSWORD!), { type: 'array', cellDates: true }),
  { insurers: ['nextcare'] },
).rows

// Plans each client is on, from the reports (stand-in for her packages/approvals).
const plans = new Map<string, Set<string>>()
for (const r of reports) {
  const id = idFor(r.name)
  if (id && (r.info === 'insurance' || r.info === 'package')) plans.set(id, (plans.get(id) ?? new Set()).add(r.info))
}
const fakeBase = { owner_id: 'u', created_at: '', updated_at: '', notes: null, used_before_app_as_of: null, sessions_used_in_app: 0, last_session_on: null, client: null, status: 'active' as const }
const packages: PackageWithBalance[] = []
const approvals: ApprovalWithBalance[] = []
for (const [id, kinds] of plans) {
  if (kinds.has('package'))
    packages.push({ ...fakeBase, id: `p:${id}`, client_id: id, sessions_total: 100, sessions_used_before_app: 0, sessions_used: 0, sessions_remaining: 100, price_total: 3800, per_session: 38, amount_paid: null, purchased_on: '2026-01-01', source_voucher: null })
  if (kinds.has('insurance'))
    approvals.push({ ...fakeBase, id: `a:${id}`, client_id: id, insurer: 'x', serial_number: null, sessions_approved: 100, sessions_used_before_app: 0, sessions_used: 0, sessions_remaining: 100, billed_per_session: 25, copay_per_session: 0, approved_on: null, valid_until: null })
}

// --- Compare each reported day -----------------------------------------------
const toBilling = (info: OldReportRow['info']): BillingType | null =>
  info === 'insurance' ? 'insurance' : info === 'package' ? 'package' : info === 'free' ? 'free' : info === 'cash' || info === 'pos' ? 'per_session' : null

const lines: string[] = ['# Rebuilt days vs her daily reports', '']
const totals = { days: 0, oldClients: 0, matched: 0, onlyOld: 0, onlyApp: 0, collectedSame: 0, collectedDiff: 0, billingSame: 0, billingDiff: 0 }
const reportDates = [...new Set(reports.map((r) => r.date))].sort()

for (const date of reportDates) {
  const day = days.find((d) => d.date === date)
  const entries: EntryInput[] = (day?.rows ?? []).map((r, i) => {
    const id = r.booking ? idFor(r.booking.name) : null
    return {
      id: `${date}-${i}`,
      slot_time: r.slotTime,
      therapist: r.therapist,
      parsed_name: r.booking?.name ?? null,
      raw_text: r.rawText,
      status: r.booking?.status ?? 'unknown',
      session_no: r.booking?.sessionNo ?? null,
      billing_note: r.booking?.billingNote ?? null,
      is_non_client: r.isNonClient,
      client_id: id,
      match_kind: id ? 'exact' : 'none',
    }
  })
  const cash: CashInput[] = cashRows
    .filter((c) => c.date === date)
    .map((c) => ({
      id: c.sourceKey,
      name_raw: c.nameRaw,
      description: c.description,
      debit: c.debit,
      credit: c.credit,
      method: c.method,
      pos_amount: c.descAmount,
      kind: c.kind,
      client_id: c.kind === 'expense' ? null : idFor(c.nameRaw),
    }))
  const draft = buildDayDraft({ date, entries, cash, packages, approvals, clientNames, expenseLabels: new Map(), defaults: { perSessionPrice: 45, insuranceBilled: 25 } })

  const old = reports.filter((r) => r.date === date)
  const oldById = new Map<string, OldReportRow[]>()
  for (const r of old) {
    const id = idFor(r.name) ?? `?${normalizeName(r.name)}`
    oldById.set(id, [...(oldById.get(id) ?? []), r])
  }
  const appById = new Map<string, typeof draft.rows>()
  for (const r of draft.rows) {
    const id = r.clientId ?? `?${normalizeName(r.rawName ?? r.clientName)}`
    appById.set(id, [...(appById.get(id) ?? []), r])
  }

  totals.days++
  totals.oldClients += oldById.size
  const issues: string[] = []
  for (const [id, olds] of oldById) {
    const apps = appById.get(id)
    const name = olds[0].name
    if (!apps) {
      totals.onlyOld++
      issues.push(`- only in her report: **${name}** (${olds.map((o) => o.infoRaw || 'no info').join(', ')}, paid ${olds.map((o) => o.paid ?? 0).join('+')})`)
      continue
    }
    totals.matched++
    const oldPaid = olds.reduce((s, o) => s + (o.paid ?? 0), 0)
    const appPaid = apps.reduce((s, a) => s + a.collected, 0)
    if (Math.abs(oldPaid - appPaid) < 0.01) totals.collectedSame++
    else {
      totals.collectedDiff++
      issues.push(`- collected differs for **${name}**: report $${oldPaid}, app $${appPaid}`)
    }
    const oldBilling = toBilling(olds[0].info)
    if (!oldBilling || oldBilling === apps[0].billingType) totals.billingSame++
    else {
      totals.billingDiff++
      issues.push(`- billing differs for **${name}**: report ${olds[0].infoRaw}, app ${apps[0].billingType}`)
    }
  }
  for (const [id, apps] of appById) {
    if (oldById.has(id)) continue
    totals.onlyApp++
    const a = apps[0]
    issues.push(`- only in the app: **${a.clientName}** (${a.status}, ${a.billingType}, collected $${a.collected}; ${a.flags.map((f) => f.kind).join(', ') || 'no flags'})`)
  }
  lines.push(`## ${date}: ${oldById.size} in her report, ${appById.size} in the app`, '', ...(issues.length ? issues : ['- identical']), '')
}

writeFileSync(join(SAMPLES, 'report-comparison.md'), lines.join('\n'))
console.log(totals)
console.log('Details (with names): samples/report-comparison.md')
