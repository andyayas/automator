import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { DateNav, LinkClientDialog } from '../components/schedule-ui'
import { DaySources } from '../components/DaySources'
import { SheetRefresh } from '../components/SheetRefresh'
import { StepBar, StepNav, type ReviewStep } from '../components/ReviewSteps'
import { Badge, ErrorCard, Loading, PageHeader, Section } from '../components/ui'
import { createApproval, createPackage, type ApprovalWithBalance, type PackageWithBalance } from '../lib/api'
import { confirmDay, downloadFile, downloadSavedReport, downloadTemplate, fetchMonth, dayBefore, reopenDay, saveReport, type SessionAnchor } from '../lib/day-api'
import { buildDayDraft, SECTION_LABEL, SECTION_ORDER, type BillingType, type DayRow } from '../lib/day-builder'
import { applyEdits, closingBalance, editsFromSessions, emptyEdits, frozenEdits, toReportData, type DayEdits, type RowEdit } from '../lib/day-edits'
import { DEFAULT_PRICES, SETTING } from '../lib/defaults'
import { monthReportDays, monthUpTo } from '../lib/month-report'
import { formatDate, formatMoney, formatTime, numberText, parseNumber, plural, todayISO } from '../lib/format'
import {
  useApprovals,
  useClients,
  useDayCash,
  useDayReview,
  useExpenseLabels,
  useInvalidate,
  useLatestCashDate,
  usePackages,
  useScheduleDay,
  useSettings,
} from '../lib/queries'
import { searchClients } from '../lib/search'
import { openDialog } from '../lib/dialog'
import { formatSlotTime } from '../lib/schedule'

// Her edits are kept on this device while she works, so leaving the page loses nothing.
const editsKey = (date: string) => `clinic-admin.day-edits.${date}`
function loadEdits(date: string): DayEdits {
  try {
    const raw = localStorage.getItem(editsKey(date))
    return raw ? { ...emptyEdits(), ...(JSON.parse(raw) as DayEdits) } : emptyEdits()
  } catch {
    return emptyEdits()
  }
}
function storeEdits(date: string, edits: DayEdits | null) {
  try {
    if (edits) localStorage.setItem(editsKey(date), JSON.stringify(edits))
    else localStorage.removeItem(editsKey(date))
  } catch {
    // Storage unavailable: edits only live in memory.
  }
}

export function DayReviewPage() {
  const { date = todayISO() } = useParams()
  const navigate = useNavigate()
  return <DayReview key={date} date={date} onDate={(d) => navigate(`/day/${d}`, { replace: true })} />
}

function DayReview({ date, onDate }: { date: string; onDate: (d: string) => void }) {
  const entries = useScheduleDay(date)
  const cash = useDayCash(date)
  const packages = usePackages()
  const approvals = useApprovals()
  const clients = useClients()
  const labels = useExpenseLabels()
  const settings = useSettings()
  const review = useDayReview(date)
  const latestCash = useLatestCashDate()
  const reviewsFrom = (settings.data?.[SETTING.reviewsFrom] as string | undefined) ?? null
  // The month so far: every report is one file with a tab per confirmed day up to this one.
  const month = useQuery({
    queryKey: ['day-review', 'month-upto', date, reviewsFrom],
    queryFn: () => fetchMonth(date.slice(0, 7), date, reviewsFrom),
    enabled: Boolean(settings.data),
  })
  const invalidate = useInvalidate()

  const [edits, setEdits] = useState<DayEdits>(() => loadEdits(date))
  const [editing, setEditing] = useState<DayRow | null>(null)
  const [linking, setLinking] = useState<DayRow | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<ReviewStep | null>(null)
  const [visited, setVisited] = useState<ReviewStep[]>([])
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    storeEdits(date, edits)
  }, [date, edits])

  const defaults = useMemo(
    () => ({
      perSessionPrice: Number(settings.data?.[SETTING.perSessionPrice] ?? DEFAULT_PRICES.perSessionPrice),
      insuranceBilled: Number(settings.data?.[SETTING.insuranceBilled] ?? DEFAULT_PRICES.insuranceBilled),
    }),
    [settings.data],
  )
  const ready = Boolean(entries.data && cash.data && packages.data && approvals.data && clients.data && labels.data && settings.data)
  const draft = useMemo(() => {
    if (!entries.data || !cash.data || !packages.data || !approvals.data || !clients.data || !labels.data) return null
    return buildDayDraft({
      date,
      entries: entries.data,
      cash: cash.data,
      packages: packages.data,
      approvals: approvals.data,
      clientNames: new Map(clients.data.map((c) => [c.id, c.name])),
      clientPrices: new Map(clients.data.filter((c) => c.per_session_price !== null).map((c) => [c.id, Number(c.per_session_price)])),
      expenseLabels: labels.data,
      defaults,
      asIncome: new Set(edits.asIncome),
      asSession: new Set(edits.asSession),
    })
  }, [date, entries.data, cash.data, packages.data, approvals.data, clients.data, labels.data, defaults, edits.asIncome, edits.asSession])

  const confirmed = Boolean(review.data?.review?.confirmed_at)
  const final = useMemo(() => (draft ? applyEdits(draft, edits) : null), [draft, edits])
  const expenses = useMemo(
    () => (draft?.expenses ?? []).map((e) => ({ ...e, label: edits.labels[e.cashId] ?? e.label })),
    [draft, edits.labels],
  )
  const otherIncome = useMemo(
    () => (draft?.otherIncome ?? []).map((e) => ({ ...e, label: edits.labels[e.cashId] ?? e.label })),
    [draft, edits.labels],
  )
  const update = (fn: (e: DayEdits) => DayEdits) => setEdits((prev) => fn(structuredClone(prev)))
  /** Move cash rows between "other income" and a client session. */
  const moveCash = (ids: string[], to: 'income' | 'session') =>
    update((e) => ({
      ...e,
      asIncome: to === 'income' ? [...new Set([...e.asIncome, ...ids])] : e.asIncome.filter((x) => !ids.includes(x)),
      asSession: to === 'session' ? [...new Set([...e.asSession, ...ids])] : e.asSession.filter((x) => !ids.includes(x)),
    }))
  // Step 1 is done when the cash statement reaches this day and the schedule is loaded.
  const cashOk = Boolean(latestCash.data && latestCash.data >= date)
  const bookings = (entries.data ?? []).filter((e) => !e.is_non_client).length
  const dataOk = cashOk && Boolean(entries.data?.length)

  // Open on step 1 only when the data isn't in yet; otherwise straight on Clients.
  // (Set while rendering, React's pattern for state that starts from loaded data.)
  if (ready && latestCash.isFetched && step === null) setStep(dataOk ? 'clients' : 'data')
  const current: ReviewStep = step ?? 'data'

  const go = (next: ReviewStep) => {
    setVisited((v) => (v.includes(current) ? v : [...v, current]))
    setStep(next)
    window.scrollTo({ top: 0 })
  }

  const editRow = (key: string, change: RowEdit) => update((e) => ({ ...e, rows: { ...e.rows, [key]: { ...e.rows[key], ...change } } }))

  if (review.isError || entries.isError || cash.isError) {
    return (
      <section className="page">
        <PageHeader title="Daily review" back="/" />
        <ErrorCard error={review.error ?? entries.error ?? cash.error} />
      </section>
    )
  }

  /**
   * The report file: the month so far, one tab per confirmed day, ending with
   * this day. `rowsForReport` is the draft being reviewed (preview or confirm);
   * null rebuilds a confirmed day from what was saved. Nothing is saved here.
   */
  async function makeReport(rowsForReport: DayRow[] | null) {
    const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    const [monthData, { buildMonthReport }, templateBytes] = await Promise.all([
      fetchMonth(date.slice(0, 7), date, reviewsFrom),
      import('../lib/report'),
      downloadTemplate(),
    ])
    const stored = monthReportDays({ ...monthData, packages: packages.data ?? [], approvals: approvals.data ?? [] })
    const current = rowsForReport
      ? { ...toReportData(rowsForReport, expenses, otherIncome, packages.data ?? [], dateLabel, approvals.data ?? []), cashBalance: closingBalance(cash.data ?? []) }
      : null
    return buildMonthReport(templateBytes, monthUpTo(stored, date, current))
  }

  async function onPreview() {
    if (!final) return
    setBusy('Building the preview…')
    setError(null)
    try {
      downloadFile(await makeReport(final.rows), `Daily Report ${date} (preview).xlsx`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function onConfirm() {
    if (!final || !draft) return
    setBusy('Saving the day…')
    setError(null)
    try {
      // Session numbers she typed on a package / insurance row re-anchor its count.
      const anchors = final.rows.flatMap<SessionAnchor>((r) => {
        if (!edits.rows[r.key]?.sessionAnchor || !r.sessionNo) return []
        if (r.billingType === 'package' && r.packageId) {
          const p = packages.data?.find((x) => x.id === r.packageId)
          return p ? [{ kind: 'package' as const, id: p.id, sessionNo: r.sessionNo, total: p.sessions_total }] : []
        }
        if (r.billingType === 'insurance' && r.approvalId) {
          const a = approvals.data?.find((x) => x.id === r.approvalId)
          return a ? [{ kind: 'approval' as const, id: a.id, sessionNo: r.sessionNo, total: a.sessions_approved }] : []
        }
        return []
      })
      await confirmDay(date, final.rows, draft.expenses, new Map(Object.entries(edits.labels)), draft.otherIncome, {
        edits: frozenEdits(final.rows, edits),
        defaultPrice: defaults.perSessionPrice,
        anchors,
      })
      setBusy('Filling the report…')
      const bytes = await makeReport(final.rows)
      setBusy('Saving the report…')
      await saveReport(date, bytes)
      downloadFile(bytes, `Daily Report ${date}.xlsx`)
      storeEdits(date, null)
      setEdits(emptyEdits())
      await invalidate.day()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  /** Reopens a confirmed day with everything as she confirmed it, to change one thing and confirm again. */
  async function onReopen() {
    if (!window.confirm('Edit this day? It opens as you confirmed it; its sessions count again once you confirm it again.')) return
    setBusy('Opening the day…')
    try {
      const saved = review.data?.review?.edits as unknown as DayEdits | null
      const restored = saved ? { ...emptyEdits(), ...saved } : draft ? editsFromSessions(draft, review.data?.sessions ?? []) : emptyEdits()
      await reopenDay(date)
      storeEdits(date, restored)
      setEdits(restored)
      setStep('clients')
      await invalidate.day()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function onDownload() {
    setBusy('Building the report…')
    setError(null)
    try {
      // Rebuilt from the confirmed days, so a corrected earlier day shows corrected.
      downloadFile(await makeReport(null), `Daily Report ${date}.xlsx`)
    } catch (err) {
      const path = review.data?.review?.report_storage_path
      if (path) downloadFile(await downloadSavedReport(path), `Daily Report ${date}.xlsx`)
      else setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const rows = final?.rows ?? []
  const attention = rows.filter((r) => r.flags.length)
  const totals = {
    billed: rows.reduce((s, r) => s + r.billed, 0),
    collected: rows.reduce((s, r) => s + r.collected, 0),
    expenses: expenses.reduce((s, e) => s + e.amount, 0),
    otherIncome: otherIncome.reduce((s, e) => s + e.amount, 0),
  }
  const net = totals.collected + totals.otherIncome - totals.expenses
  const marks = {
    data: { done: dataOk },
    clients: { done: !attention.length && (visited.includes('clients') || current === 'money' || current === 'confirm'), count: attention.length },
    money: { done: visited.includes('money') },
  }

  return (
    <section className="page">
      <PageHeader title="Daily review" back="/" />
      <DateNav date={date} onChange={onDate} />
      {error && <p className="error" role="alert">{error}</p>}

      {!ready || review.isPending || (!confirmed && !step) ? (
        <Loading />
      ) : confirmed ? (
        <ConfirmedDay
          date={date}
          sessions={review.data!.sessions}
          confirmedAt={review.data!.review!.confirmed_at!}
          monthNote={<MonthTabsNote date={date} month={month.data} />}
          busy={busy}
          onDownload={onDownload}
          onReopen={onReopen}
        />
      ) : (
        <>
          <StepBar current={current} marks={marks} onPick={go} />

          {current === 'data' && (
            <>
              <DaySources date={date} />
              <div className="card schedule-card">
                <div className="source-row">
                  <span className="row-text">
                    <span className="strong">Schedule</span>
                    <span className="muted small">
                      {entries.data!.length ? `${plural(bookings, 'booking')} for this day` : 'No schedule loaded for this day yet'}
                    </span>
                  </span>
                  {entries.data!.length ? <Badge tone="accent">Loaded</Badge> : <Badge tone="warn">Missing</Badge>}
                </div>
                <SheetRefresh date={date} />
              </div>
            </>
          )}

          {current === 'clients' && (
            <>
              <div className="card day-summary">
                <div>
                  <p className="strong">{plural(rows.length, 'client')}</p>
                  <p className="muted small">
                    Billed {formatMoney(totals.billed)} · Collected {formatMoney(totals.collected)}
                  </p>
                </div>
                {attention.length ? <Badge tone="warn">{attention.length} to check</Badge> : <Badge tone="accent">All clear</Badge>}
              </div>
            {attention.length > 0 && (
              <Section title="Needs a look" count={attention.length}>
                <div className="stack">
                  {attention.map((r) => (
                    <RowCard
                      key={r.key}
                      row={r}
                      onEdit={() => setEditing(r)}
                      onLink={() => setLinking(r)}
                      onFree={() => editRow(r.key, { billingType: 'free', billed: 0 })}
                      onConfirm={r.clientId ? () => editRow(r.key, {}) : undefined}
                      onRemove={() => update((e) => ({ ...e, removed: [...e.removed, r.key] }))}
                      onIncome={r.status === 'walk-in' && r.cashIds.length ? () => moveCash(r.cashIds, 'income') : undefined}
                    />
                  ))}
                </div>
              </Section>
            )}

            {SECTION_ORDER.map((type) => {
              const list = rows.filter((r) => r.billingType === type && !r.flags.length)
              if (!list.length) return null
              return (
                <Section key={type} title={SECTION_LABEL[type]} count={list.length}>
                  <div className="stack">
                    {list.map((r) => (
                      <RowCard key={r.key} row={r} onEdit={() => setEditing(r)} />
                    ))}
                  </div>
                </Section>
              )
            })}

            <button type="button" className="button block" onClick={() => setAdding(true)}>
              Add a client to this day
            </button>

            {final!.excluded.length > 0 && (
              <details className="details card">
                <summary>Not counted ({final!.excluded.length})</summary>
                <div className="card list">
                  {final!.excluded.map((r) => (
                    <div key={r.key} className="list-row">
                      <span className="row-text">
                        <span>{r.clientName}</span>
                        <span className="muted small">
                          {r.status === 'cancelled' ? 'Cancelled (X)' : r.status === 'rescheduled' ? 'Rescheduled (R)' : 'Removed'}
                          {r.slotTime ? ` · ${formatSlotTime(r.slotTime)}` : ''}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="button small-button"
                        onClick={() =>
                          update((e) =>
                            e.removed.includes(r.key)
                              ? { ...e, removed: e.removed.filter((k) => k !== r.key) }
                              : { ...e, restored: [...e.restored, r.key] },
                          )
                        }
                      >
                        Add back
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            )}

            </>
          )}

          {current === 'money' && (
            <>
            <Section title="Expenses" count={expenses.length}>
              {expenses.length ? (
                <div className="card list">
                  {expenses.map((e) => (
                    <div key={e.cashId} className="list-row">
                      <input
                        className="inline-input"
                        value={e.label}
                        aria-label="Expense label"
                        onChange={(ev) => update((x) => ({ ...x, labels: { ...x.labels, [e.cashId]: ev.target.value } }))}
                      />
                      <span className="strong nowrap">{formatMoney(e.amount)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty">No expenses in the cash statement for this day.</p>
              )}
            </Section>

            <Section title="Other income" count={otherIncome.length}>
              <p className="muted small">Money in that isn’t a client session: insurer payments, outdoor, tests…</p>
              {otherIncome.length ? (
                <div className="card list">
                  {otherIncome.map((e) => (
                    <div key={e.cashId} className="income-row">
                      <input
                        className="inline-input"
                        value={e.label}
                        aria-label="Other income label"
                        onChange={(ev) => update((x) => ({ ...x, labels: { ...x.labels, [e.cashId]: ev.target.value } }))}
                      />
                      <div className="income-row-foot">
                        <span className="strong">{formatMoney(e.amount)}</span>
                        <button type="button" className="button ghost small-button" onClick={() => moveCash([e.cashId], 'session')}>
                          It’s a client session
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty">None for this day.</p>
              )}
            </Section>

              <div className="card money-totals">
                <span className="muted small">Collected {formatMoney(totals.collected)}</span>
                <span className="muted small">Other income {formatMoney(totals.otherIncome)}</span>
                <span className="muted small">Expenses {formatMoney(totals.expenses)}</span>
                <span className="strong">Net {formatMoney(net)}</span>
              </div>
            </>
          )}

          {current === 'confirm' && (
            <>
              <MonthTabsNote date={date} month={month.data} />
              <div className="card list day-totals">
                {[
                  ['Clients', String(rows.length)],
                  ['Billed', formatMoney(totals.billed)],
                  ['Collected', formatMoney(totals.collected)],
                  ['Other income', formatMoney(totals.otherIncome)],
                  ['Expenses', formatMoney(totals.expenses)],
                ].map(([label, value]) => (
                  <div key={label} className="list-row">
                    <span className="muted">{label}</span>
                    <span>{value}</span>
                  </div>
                ))}
                <div className="list-row">
                  <span className="strong">Net</span>
                  <span className="strong">{formatMoney(net)}</span>
                </div>
              </div>
              {(attention.length > 0 || !dataOk) && (
                <div className="card notice stack">
                  {!dataOk && (
                    <div className="inline-action">
                      <p className="small">{cashOk ? 'The schedule isn’t loaded for this day.' : 'The cash statement isn’t up to date for this day.'}</p>
                      <button type="button" className="button small-button warn" onClick={() => go('data')}>
                        Go to Data
                      </button>
                    </div>
                  )}
                  {attention.length > 0 && (
                    <div className="inline-action">
                      <p className="small">
                        {plural(attention.length, 'client')} still {attention.length === 1 ? 'needs' : 'need'} a look.
                      </p>
                      <button type="button" className="button small-button warn" onClick={() => go('clients')}>
                        Go to Clients
                      </button>
                    </div>
                  )}
                </div>
              )}
            <div className="confirm-bar">
              <button type="button" className="button block" disabled={Boolean(busy) || !(rows.length || otherIncome.length || expenses.length)} onClick={onPreview}>
                Preview report
              </button>
              <button type="button" className="button primary block" disabled={Boolean(busy) || !(rows.length || otherIncome.length || expenses.length)} onClick={onConfirm}>
                {busy ?? 'Confirm and generate report'}
              </button>
              <p className="muted small center">
                Preview only downloads the file. Confirming saves the day and takes these sessions off packages and approvals.
              </p>
            </div>
            </>
          )}

          <StepNav
            current={current}
            onPick={go}
            nextNote={current === 'clients' && attention.length ? `${plural(attention.length, 'client')} still ${attention.length === 1 ? 'needs' : 'need'} a look` : undefined}
          />
        </>
      )}


      {editing && (
        <EditRowDialog
          row={editing}
          date={date}
          defaults={defaults}
          packages={(packages.data ?? []).filter((p) => p.client_id === editing.clientId && p.status === 'active')}
          approvals={(approvals.data ?? []).filter((a) => a.client_id === editing.clientId && a.status === 'active')}
          onSave={(change) => {
            editRow(editing.key, change)
            setEditing(null)
          }}
          onRemove={() => {
            update((e) => ({ ...e, removed: [...e.removed, editing.key] }))
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {linking && <LinkClientDialog name={linking.rawName ?? linking.clientName} onClose={() => setLinking(null)} />}
      {adding && (
        <AddClientDialog
          onAdd={(client) => {
            update((e) => ({
              ...e,
              added: [
                ...e.added,
                {
                  key: `added:${crypto.randomUUID()}`,
                  clientId: client.id,
                  clientName: client.name,
                  therapist: null,
                  slotTime: null,
                  status: 'walk-in',
                  billingType: 'per_session',
                  packageId: null,
                  approvalId: null,
                  serialNumber: null,
                  sessionNo: null,
                  sheetSessionNo: null,
                  billed: defaults.perSessionPrice,
                  collected: 0,
                  paymentMethod: null,
                  extraNote: '',
                  scheduleEntryId: null,
                  cashIds: [],
                  rawName: null,
                  flags: [],
                },
              ],
            }))
            setAdding(false)
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </section>
  )
}

const BILLING_TONE: Record<BillingType, 'accent' | 'warn' | 'neutral'> = {
  insurance: 'accent',
  package: 'accent',
  per_session: 'neutral',
  free: 'neutral',
}

function RowCard({
  row: r,
  onEdit,
  onLink,
  onFree,
  onConfirm,
  onRemove,
  onIncome,
}: {
  row: DayRow
  onEdit: () => void
  onLink?: () => void
  onFree?: () => void
  /** Accept the row as it is (it came, the amounts are right). */
  onConfirm?: () => void
  onRemove?: () => void
  onIncome?: () => void
}) {
  const kinds = new Set(r.flags.map((f) => f.kind))
  return (
    <article className="card day-row">
      <button type="button" className="day-row-main" onClick={onEdit}>
        <span className="row-text">
          <span className="strong">{r.clientName}</span>
          <span className="muted small">
            {[r.slotTime ? formatSlotTime(r.slotTime) : null, r.therapist, r.status === 'walk-in' ? 'not on the schedule' : null].filter(Boolean).join(' · ')}
          </span>
          <span className="small">
            Billed {formatMoney(r.billed)} · Collected {formatMoney(r.collected)}
            {r.sessionNo ? ` · Session ${r.sessionNo}` : ''}
            {r.paymentMethod && r.paymentMethod !== 'cash' ? ` · ${r.paymentMethod.toUpperCase()}` : ''}
          </span>
        </span>
        <Badge tone={BILLING_TONE[r.billingType]}>{SECTION_LABEL[r.billingType]}</Badge>
      </button>
      {r.flags.length > 0 && (
        <div className="day-flags">
          {r.flags.map((f) => (
            <span key={f.kind} className="flag small">
              {f.text}
            </span>
          ))}
          <div className="row-buttons">
            {(kinds.has('unmatched') || kinds.has('uncertain-name')) && onLink && (
              <button type="button" className="button small-button primary" onClick={onLink}>
                Who is this?
              </button>
            )}
            {onIncome && (
              <button type="button" className="button small-button" onClick={onIncome}>
                Other income
              </button>
            )}
            {kinds.has('not-paid') && onFree && (
              <button type="button" className="button small-button" onClick={onFree}>
                Mark as Free
              </button>
            )}
            {onConfirm && !kinds.has('unmatched') && (
              <button type="button" className="button small-button primary" onClick={onConfirm}>
                Confirm
              </button>
            )}
            {(kinds.has('no-status') || kinds.has('not-paid')) && onRemove && (
              <button type="button" className="button small-button ghost danger" onClick={onRemove}>
                Didn’t come
              </button>
            )}
            <button type="button" className="button small-button ghost" onClick={onEdit}>
              Edit
            </button>
          </div>
        </div>
      )}
    </article>
  )
}

const NEW = '__new'

function EditRowDialog({
  row,
  date,
  defaults,
  packages,
  approvals,
  onSave,
  onRemove,
  onClose,
}: {
  row: DayRow
  date: string
  defaults: { perSessionPrice: number; insuranceBilled: number }
  packages: PackageWithBalance[]
  approvals: ApprovalWithBalance[]
  onSave: (change: RowEdit) => void
  onRemove: () => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const invalidate = useInvalidate()
  const [billing, setBilling] = useState<BillingType>(row.billingType)
  // No package / approval yet: the "new" option, with its own fields.
  const [packageId, setPackageId] = useState(row.packageId ?? packages[0]?.id ?? NEW)
  const [approvalId, setApprovalId] = useState(row.approvalId ?? approvals[0]?.id ?? NEW)
  const [billed, setBilled] = useState(numberText(row.billed))
  const [collected, setCollected] = useState(numberText(row.collected))
  const [sessionNo, setSessionNo] = useState(numberText(row.sessionNo))
  const [therapist, setTherapist] = useState(row.therapist ?? '')
  const [note, setNote] = useState(row.extraNote)
  const [pkg, setPkg] = useState({ sessions: '', price: '' })
  const [appr, setAppr] = useState({ insurer: '', serial: '', sessions: '', billed: numberText(defaults.insuranceBilled), copay: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => openDialog(dialog.current), [])

  const creatingPackage = billing === 'package' && packageId === NEW
  const creatingApproval = billing === 'insurance' && approvalId === NEW
  const pkgPer = (() => {
    const n = parseNumber(pkg.sessions)
    const total = parseNumber(pkg.price)
    return n && total ? Math.round(total / n) : null
  })()

  async function submit() {
    setError(null)
    const n = parseNumber(sessionNo)
    const common = {
      collected: parseNumber(collected) ?? 0,
      therapist: therapist.trim() || null,
      extraNote: note,
    }
    if ((creatingPackage || creatingApproval) && !row.clientId) return setError('Link this name to a client first (Who is this?).')
    // The day's session is session n of the new package / approval.
    const first = n && n > 0 ? n : 1
    const anchor = { sessions_used_before_app: first - 1, used_before_app_as_of: dayBefore(date), status: 'active' as const }
    try {
      if (creatingPackage) {
        const sessions = parseNumber(pkg.sessions)
        const price = parseNumber(pkg.price)
        if (!sessions || !price) return setError('Enter the package’s sessions and price.')
        if (first > sessions) return setError(`Session ${first} is more than the package’s ${sessions} sessions.`)
        setBusy(true)
        const id = await createPackage({
          client_id: row.clientId!,
          sessions_total: sessions,
          price_total: price,
          per_session: Math.round(price / sessions),
          purchased_on: date,
          ...anchor,
        })
        await invalidate.balances()
        return onSave({ ...common, billingType: 'package', packageId: id, approvalId: null, sessionNo: first, billed: Math.round(price / sessions) })
      }
      if (creatingApproval) {
        const sessions = parseNumber(appr.sessions)
        const perSession = parseNumber(appr.billed) ?? defaults.insuranceBilled
        if (!appr.insurer.trim() || !sessions) return setError('Enter the insurer and the sessions approved.')
        if (first > sessions) return setError(`Session ${first} is more than the ${sessions} approved.`)
        setBusy(true)
        const id = await createApproval({
          client_id: row.clientId!,
          insurer: appr.insurer.trim(),
          serial_number: appr.serial.trim() || null,
          sessions_approved: sessions,
          billed_per_session: perSession,
          copay_per_session: parseNumber(appr.copay) ?? 0,
          approved_on: date,
          ...anchor,
        })
        await invalidate.balances()
        return onSave({ ...common, billingType: 'insurance', approvalId: id, packageId: null, sessionNo: first, billed: perSession })
      }
      const counted = billing === 'package' || billing === 'insurance'
      onSave({
        ...common,
        billingType: billing,
        packageId: billing === 'package' ? packageId || null : null,
        approvalId: billing === 'insurance' ? approvalId || null : null,
        billed: parseNumber(billed) ?? 0,
        sessionNo: n,
        // A session number she typed re-anchors the package / approval on confirm
        // (kept if she edits the row again for something else).
        ...(counted && n !== null && n !== row.sessionNo ? { sessionAnchor: true } : {}),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <dialog ref={dialog} tabIndex={-1} className="sheet" onClose={onClose} aria-label={`Edit ${row.clientName}`}>
      <div className="sheet-head">
        <p className="strong">{row.clientName}</p>
        <button type="button" className="button ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label className="field">
          <span>Billing</span>
          <select value={billing} onChange={(e) => setBilling(e.target.value as BillingType)}>
            {SECTION_ORDER.map((t) => (
              <option key={t} value={t}>
                {SECTION_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        {billing === 'package' && (
          <label className="field">
            <span>Package</span>
            <select value={packageId} onChange={(e) => setPackageId(e.target.value)}>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sessions_total} sessions · {p.sessions_remaining} left
                </option>
              ))}
              <option value={NEW}>New package…</option>
            </select>
          </label>
        )}
        {creatingPackage && (
          <div className="card new-plan">
            <p className="small strong">New package for {row.clientName}</p>
            <div className="field-row">
              <label className="field">
                <span>Sessions</span>
                <input inputMode="numeric" value={pkg.sessions} onChange={(e) => setPkg({ ...pkg, sessions: e.target.value })} placeholder="12" />
              </label>
              <label className="field">
                <span>Price ($)</span>
                <input inputMode="decimal" value={pkg.price} onChange={(e) => setPkg({ ...pkg, price: e.target.value })} placeholder="450" />
              </label>
            </div>
            {pkgPer !== null && <p className="muted small">{formatMoney(pkgPer)} per session.</p>}
          </div>
        )}
        {billing === 'insurance' && (
          <label className="field">
            <span>Approval</span>
            <select value={approvalId} onChange={(e) => setApprovalId(e.target.value)}>
              {approvals.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.insurer} · {a.sessions_remaining} left
                </option>
              ))}
              <option value={NEW}>New approval…</option>
            </select>
          </label>
        )}
        {creatingApproval && (
          <div className="card new-plan">
            <p className="small strong">New approval for {row.clientName}</p>
            <div className="field-row">
              <label className="field">
                <span>Insurer</span>
                <input value={appr.insurer} onChange={(e) => setAppr({ ...appr, insurer: e.target.value })} />
              </label>
              <label className="field">
                <span>Serial number</span>
                <input value={appr.serial} onChange={(e) => setAppr({ ...appr, serial: e.target.value })} />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Sessions approved</span>
                <input inputMode="numeric" value={appr.sessions} onChange={(e) => setAppr({ ...appr, sessions: e.target.value })} />
              </label>
              <label className="field">
                <span>Billed per session ($)</span>
                <input inputMode="decimal" value={appr.billed} onChange={(e) => setAppr({ ...appr, billed: e.target.value })} />
              </label>
            </div>
            <label className="field">
              <span>Client co-pay ($)</span>
              <input inputMode="decimal" value={appr.copay} onChange={(e) => setAppr({ ...appr, copay: e.target.value })} placeholder="0" />
            </label>
          </div>
        )}
        <div className="field-row">
          {!(creatingPackage || creatingApproval) && (
            <label className="field">
              <span>Billed ($)</span>
              <input inputMode="decimal" value={billed} onChange={(e) => setBilled(e.target.value)} />
            </label>
          )}
          <label className="field">
            <span>Collected ($)</span>
            <input inputMode="decimal" value={collected} onChange={(e) => setCollected(e.target.value)} />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span>{creatingPackage || creatingApproval ? 'This is session no.' : 'Session no.'}</span>
            <input inputMode="numeric" value={sessionNo} onChange={(e) => setSessionNo(e.target.value)} placeholder={creatingPackage || creatingApproval ? '1' : ''} />
          </label>
          <label className="field">
            <span>Therapist</span>
            <input value={therapist} onChange={(e) => setTherapist(e.target.value)} />
          </label>
        </div>
        {(billing === 'package' || billing === 'insurance') && !(creatingPackage || creatingApproval) && (
          <p className="muted small">Changing the session no. makes the next sessions count on from it, once you confirm the day.</p>
        )}
        <label className="field">
          <span>Extra note</span>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button primary block" disabled={busy}>
          {busy ? 'Saving…' : creatingPackage ? 'Create the package and save' : creatingApproval ? 'Create the approval and save' : 'Save'}
        </button>
        <button type="button" className="button ghost danger block" onClick={onRemove}>
          Remove from this day
        </button>
      </form>
    </dialog>
  )
}

function AddClientDialog({ onAdd, onClose }: { onAdd: (c: { id: string; name: string }) => void; onClose: () => void }) {
  const clients = useClients()
  const dialog = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')
  useEffect(() => openDialog(dialog.current), [])
  const results = useMemo(() => searchClients(clients.data ?? [], query).results, [clients.data, query])
  return (
    <dialog ref={dialog} tabIndex={-1} className="sheet" onClose={onClose} aria-label="Add a client to this day">
      <div className="sheet-head">
        <p className="strong">Add a client to this day</p>
        <button type="button" className="button ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <input className="search" type="search" placeholder="Search clients" value={query} onChange={(e) => setQuery(e.target.value)} data-autofocus />
      <div className="card list sheet-list">
        {results.map((c) => (
          <button key={c.id} type="button" className="list-row link as-button" onClick={() => onAdd(c)}>
            <span>{c.name}</span>
            <span className="chevron">›</span>
          </button>
        ))}
        {query && !results.length && <p className="empty pad">No client found.</p>}
      </div>
    </dialog>
  )
}

/** What the report file holds: a tab per confirmed day of the month up to this one. */
function MonthTabsNote({ date, month }: { date: string; month?: { confirmedDates: string[]; notConfirmed: string[] } }) {
  if (!month) return null
  const monthName = new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { month: 'long' })
  const before = month.confirmedDates.filter((d) => d < date).length
  const missing = month.notConfirmed.filter((d) => d < date)
  return (
    <div className="stack">
      <p className="muted small">
        {before ? `The report file has ${before + 1} tabs, one for each confirmed day of ${monthName} up to this one.` : 'The report file has this day’s tab.'}
        {missing.length > 0 && ' Not confirmed yet, so left out:'}
      </p>
      {missing.length > 0 && (
        <div className="chips">
          {missing.map((d) => (
            <Link key={d} to={`/day/${d}`} className="chip">
              {formatDate(d, { short: true })}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function ConfirmedDay({
  date,
  sessions,
  confirmedAt,
  monthNote,
  busy,
  onDownload,
  onReopen,
}: {
  date: string
  sessions: Array<{ id: string; client_name: string | null; billing_type: string; billed: number; collected: number; session_no: number | null; therapist: string | null }>
  confirmedAt: string
  monthNote: ReactNode
  busy: string | null
  onDownload: () => void
  onReopen: () => void
}) {
  return (
    <>
      <div className="card day-summary">
        <div>
          <p className="strong">Confirmed ✓</p>
          <p className="muted small">
            {formatDate(date)} · {formatTime(confirmedAt)} ·{' '}
            {plural(sessions.length, 'client')}
          </p>
        </div>
        <Badge tone="accent">Done</Badge>
      </div>
      <button type="button" className="button primary block" disabled={Boolean(busy)} onClick={onDownload}>
        {busy ?? 'Download the report'}
      </button>
      {monthNote}
      {SECTION_ORDER.map((type) => {
        const list = sessions.filter((s) => s.billing_type === type)
        if (!list.length) return null
        return (
          <Section key={type} title={SECTION_LABEL[type]} count={list.length}>
            <div className="card list">
              {list.map((s) => (
                <div key={s.id} className="list-row">
                  <span className="row-text">
                    <span>{s.client_name}</span>
                    <span className="muted small">{[s.therapist, s.session_no ? `session ${s.session_no}` : null].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="muted small nowrap">
                    {formatMoney(Number(s.collected))} / {formatMoney(Number(s.billed))}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )
      })}
      <button type="button" className="button ghost block" disabled={Boolean(busy)} onClick={onReopen}>
        {busy ?? 'Edit this day'}
      </button>
    </>
  )
}
