import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { DateNav, LinkClientDialog } from '../components/schedule-ui'
import { DaySources } from '../components/DaySources'
import { MonthDownload } from '../components/MonthDownload'
import { StepBar, StepNav, type ReviewStep } from '../components/ReviewSteps'
import { Badge, ErrorCard, Loading, PageHeader, Section } from '../components/ui'
import type { ApprovalWithBalance, PackageWithBalance } from '../lib/api'
import { confirmDay, downloadFile, downloadSavedReport, downloadTemplate, reopenDay, saveReport } from '../lib/day-api'
import { buildDayDraft, SECTION_LABEL, SECTION_ORDER, type BillingType, type DayRow } from '../lib/day-builder'
import { applyEdits, emptyEdits, toReportData, type DayEdits, type RowEdit } from '../lib/day-edits'
import { DEFAULT_PRICES, SETTING } from '../lib/defaults'
import { formatDate, formatMoney, numberText, parseNumber, plural, todayISO } from '../lib/format'
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

  /** The Excel file for the current draft (nothing is saved here). */
  async function makeReport(rowsForReport: DayRow[]) {
    const [{ buildReport }, templateBytes] = await Promise.all([import('../lib/report'), downloadTemplate()])
    const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    return buildReport(templateBytes, toReportData(rowsForReport, expenses, otherIncome, packages.data ?? [], dateLabel))
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
      await confirmDay(date, final.rows, draft.expenses, new Map(Object.entries(edits.labels)), draft.otherIncome)
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

  async function onReopen() {
    if (!window.confirm('Reopen this day? Its sessions stop counting against packages and approvals until you confirm it again.')) return
    setBusy('Reopening…')
    try {
      await reopenDay(date)
      await invalidate.day()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function onDownload() {
    const path = review.data?.review?.report_storage_path
    if (!path) return
    try {
      downloadFile(await downloadSavedReport(path), `Daily Report ${date}.xlsx`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
          hasReport={Boolean(review.data!.review!.report_storage_path)}
          busy={busy}
          onDownload={onDownload}
          onReopen={onReopen}
        />
      ) : (
        <>
          <StepBar current={current} marks={marks} onPick={go} />

          {current === 'data' && (
            <>
              <p className="muted small">Bring in the day’s money and bookings. The app reads both; nothing to type.</p>
              <DaySources date={date} />
              <div className="card list">
                <div className="list-row">
                  <span className="row-text">
                    <span className="strong">Schedule</span>
                    <span className="muted small">
                      {entries.data!.length ? `${plural(bookings, 'booking')} for this day` : 'No schedule loaded for this day yet'}
                    </span>
                  </span>
                  {entries.data!.length ? <Badge tone="accent">Loaded</Badge> : <Badge tone="warn">Missing</Badge>}
                </div>
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
                      onCame={() => editRow(r.key, {})}
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
                          {r.slotTime ? ` · ${r.slotTime}` : ''}
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
                    <button type="button" className="link-button" onClick={() => go('data')}>
                      {cashOk ? 'The schedule isn’t loaded for this day' : 'The cash statement isn’t up to date for this day'} ›
                    </button>
                  )}
                  {attention.length > 0 && (
                    <button type="button" className="link-button" onClick={() => go('clients')}>
                      {plural(attention.length, 'client')} still {attention.length === 1 ? 'needs' : 'need'} a look ›
                    </button>
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
          {current === 'confirm' && <MonthDownload date={date} />}
        </>
      )}

      {ready && confirmed && <MonthDownload date={date} />}

      {editing && (
        <EditRowDialog
          row={editing}
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
  onCame,
  onRemove,
  onIncome,
}: {
  row: DayRow
  onEdit: () => void
  onLink?: () => void
  onFree?: () => void
  onCame?: () => void
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
            {[r.slotTime, r.therapist, r.status === 'walk-in' ? 'not on the schedule' : null].filter(Boolean).join(' · ')}
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
            {kinds.has('no-status') && onCame && (
              <button type="button" className="button small-button" onClick={onCame}>
                Came
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

function EditRowDialog({
  row,
  packages,
  approvals,
  onSave,
  onRemove,
  onClose,
}: {
  row: DayRow
  packages: PackageWithBalance[]
  approvals: ApprovalWithBalance[]
  onSave: (change: RowEdit) => void
  onRemove: () => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [billing, setBilling] = useState<BillingType>(row.billingType)
  const [packageId, setPackageId] = useState(row.packageId ?? packages[0]?.id ?? '')
  const [approvalId, setApprovalId] = useState(row.approvalId ?? approvals[0]?.id ?? '')
  const [billed, setBilled] = useState(numberText(row.billed))
  const [collected, setCollected] = useState(numberText(row.collected))
  const [sessionNo, setSessionNo] = useState(numberText(row.sessionNo))
  const [therapist, setTherapist] = useState(row.therapist ?? '')
  const [note, setNote] = useState(row.extraNote)
  useEffect(() => dialog.current?.showModal(), [])

  return (
    <dialog ref={dialog} className="sheet" onClose={onClose} aria-label={`Edit ${row.clientName}`}>
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
          onSave({
            billingType: billing,
            packageId: billing === 'package' ? packageId || null : null,
            approvalId: billing === 'insurance' ? approvalId || null : null,
            billed: parseNumber(billed) ?? 0,
            collected: parseNumber(collected) ?? 0,
            sessionNo: parseNumber(sessionNo),
            therapist: therapist.trim() || null,
            extraNote: note,
          })
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
              {!packages.length && <option value="">No active package</option>}
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sessions_total} sessions · {p.sessions_remaining} left
                </option>
              ))}
            </select>
          </label>
        )}
        {billing === 'insurance' && (
          <label className="field">
            <span>Approval</span>
            <select value={approvalId} onChange={(e) => setApprovalId(e.target.value)}>
              {!approvals.length && <option value="">No active approval</option>}
              {approvals.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.insurer} · {a.sessions_remaining} left
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="field-row">
          <label className="field">
            <span>Billed ($)</span>
            <input inputMode="decimal" value={billed} onChange={(e) => setBilled(e.target.value)} />
          </label>
          <label className="field">
            <span>Collected ($)</span>
            <input inputMode="decimal" value={collected} onChange={(e) => setCollected(e.target.value)} />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span>Session no.</span>
            <input inputMode="numeric" value={sessionNo} onChange={(e) => setSessionNo(e.target.value)} />
          </label>
          <label className="field">
            <span>Therapist</span>
            <input value={therapist} onChange={(e) => setTherapist(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Extra note</span>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" className="button primary block">
          Save
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
  useEffect(() => dialog.current?.showModal(), [])
  const results = useMemo(() => searchClients(clients.data ?? [], query).results, [clients.data, query])
  return (
    <dialog ref={dialog} className="sheet" onClose={onClose} aria-label="Add a client to this day">
      <div className="sheet-head">
        <p className="strong">Add a client to this day</p>
        <button type="button" className="button ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <input className="search" type="search" placeholder="Search clients" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
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

function ConfirmedDay({
  date,
  sessions,
  confirmedAt,
  hasReport,
  busy,
  onDownload,
  onReopen,
}: {
  date: string
  sessions: Array<{ id: string; client_name: string | null; billing_type: string; billed: number; collected: number; session_no: number | null; therapist: string | null }>
  confirmedAt: string
  hasReport: boolean
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
            {formatDate(date)} · {new Date(confirmedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ·{' '}
            {plural(sessions.length, 'client')}
          </p>
        </div>
        <Badge tone="accent">Done</Badge>
      </div>
      {hasReport && (
        <button type="button" className="button primary block" onClick={onDownload}>
          Download the report
        </button>
      )}
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
        {busy ?? 'Reopen this day to change it'}
      </button>
    </>
  )
}
