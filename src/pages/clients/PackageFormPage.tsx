import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ErrorCard, Loading, PageHeader } from '../../components/ui'
import { deletePackage, savePackage, type PackageWithBalance, type Status } from '../../lib/api'
import { numberText, parseNumber, perSessionValue, todayISO } from '../../lib/format'
import { useClient, useInvalidate, usePackage } from '../../lib/queries'
import { Field, SessionsSummary, StatusSelect, UsedBeforeFields } from './form-parts'

/** /clients/:clientId/packages/new or /packages/:packageId */
export function PackageFormPage() {
  const { clientId, packageId } = useParams()
  const existing = usePackage(packageId ?? '')
  if (packageId && existing.isPending) return <section className="page"><PageHeader title="Package" /><Loading /></section>
  if (packageId && existing.isError) return <section className="page"><ErrorCard error={existing.error} /></section>
  const pkg = packageId ? existing.data : undefined
  return <PackageForm key={pkg?.id ?? 'new'} pkg={pkg} clientId={pkg?.client_id ?? clientId ?? ''} />
}

function PackageForm({ pkg, clientId }: { pkg?: PackageWithBalance; clientId: string }) {
  const navigate = useNavigate()
  const invalidate = useInvalidate()
  const client = useClient(clientId)
  const [sessions, setSessions] = useState(numberText(pkg?.sessions_total))
  const [price, setPrice] = useState(numberText(pkg?.price_total))
  const [perSessionText, setPerSessionText] = useState(numberText(pkg?.per_session))
  const [perSessionEdited, setPerSessionEdited] = useState(Boolean(pkg))
  const [purchasedOn, setPurchasedOn] = useState(pkg?.purchased_on ?? todayISO())
  const [voucher, setVoucher] = useState(pkg?.source_voucher ?? '')
  const [used, setUsed] = useState(numberText(pkg?.sessions_used_before_app ?? 0))
  const [asOf, setAsOf] = useState(pkg?.used_before_app_as_of ?? todayISO())
  const [status, setStatus] = useState<Status>(pkg?.status ?? 'active')
  const [notes, setNotes] = useState(pkg?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const back = `/clients/${clientId}`

  const autoPerSession = perSessionValue(parseNumber(price), parseNumber(sessions))
  const shownPerSession = perSessionEdited ? perSessionText : numberText(autoPerSession)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const n = parseNumber(sessions)
    const total = parseNumber(price)
    const each = parseNumber(shownPerSession)
    const usedN = parseNumber(used) ?? 0
    if (!n || n < 1 || !Number.isInteger(n)) return setError('Sessions must be a whole number of at least 1.')
    if (total === null || total < 0) return setError('Enter the package price.')
    if (each === null || each < 0) return setError('Enter the value per session.')
    if (!Number.isInteger(usedN) || usedN < 0 || usedN > n) return setError(`Sessions already used must be between 0 and ${n}.`)
    setSaving(true)
    setError(null)
    try {
      await savePackage(pkg?.id ?? null, {
        client_id: clientId,
        sessions_total: n,
        price_total: total,
        per_session: each,
        purchased_on: purchasedOn || null,
        source_voucher: voucher.trim() || null,
        sessions_used_before_app: usedN,
        used_before_app_as_of: usedN > 0 ? asOf || null : null,
        status,
        notes: notes.trim() || null,
      })
      await invalidate.balances()
      navigate(back, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  async function onDelete() {
    if (!pkg || !window.confirm('Delete this package? This cannot be undone.')) return
    try {
      await deletePackage(pkg.id)
      await invalidate.balances()
      navigate(back, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="page">
      <PageHeader title={pkg ? 'Edit package' : 'New package'} back={back} />
      {client.data && <p className="muted">{client.data.name}</p>}
      <form className="card form" onSubmit={onSubmit} noValidate>
        <div className="field-row">
          <Field label="Sessions">
            <input inputMode="numeric" value={sessions} onChange={(e) => setSessions(e.target.value)} required />
          </Field>
          <Field label="Price ($)">
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required />
          </Field>
        </div>

        <Field
          label="Per session ($)"
          hint={perSessionEdited ? undefined : 'Worked out from price ÷ sessions. Type to change it.'}
        >
          <input
            inputMode="decimal"
            value={shownPerSession}
            onChange={(e) => {
              setPerSessionEdited(true)
              setPerSessionText(e.target.value)
            }}
          />
        </Field>

        <div className="field-row">
          <Field label="Bought on">
            <input type="date" value={purchasedOn} onChange={(e) => setPurchasedOn(e.target.value)} />
          </Field>
          <Field label="Receipt (voucher)">
            <input value={voucher} onChange={(e) => setVoucher(e.target.value)} placeholder="rc…" autoCapitalize="none" />
          </Field>
        </div>

        <UsedBeforeFields used={used} asOf={asOf} onUsed={setUsed} onAsOf={setAsOf} />
        {pkg && <SessionsSummary inApp={pkg.sessions_used_in_app} remaining={pkg.sessions_remaining} />}

        <StatusSelect value={status} onChange={setStatus} allowProposed={pkg?.status === 'proposed'} />

        <Field label="Notes">
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="button primary block" disabled={saving || !clientId}>
          {saving ? 'Saving…' : 'Save package'}
        </button>
        {pkg && (
          <button type="button" className="button ghost danger block" onClick={onDelete}>
            Delete package
          </button>
        )}
      </form>
    </section>
  )
}
