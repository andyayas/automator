import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ErrorCard, Loading, PageHeader } from '../../components/ui'
import { deleteApproval, saveApproval, type ApprovalWithBalance, type Status } from '../../lib/api'
import { numberText, parseNumber, todayISO } from '../../lib/format'
import { useApproval, useClient, useInsurers, useInvalidate } from '../../lib/queries'
import { Field, SessionsSummary, StatusSelect, UsedBeforeFields } from './form-parts'

/** Typical insurance billing per session (CLAUDE.md); she can change it per approval. */
const DEFAULT_BILLED = 25

/** /clients/:clientId/approvals/new or /approvals/:approvalId */
export function ApprovalFormPage() {
  const { clientId, approvalId } = useParams()
  const existing = useApproval(approvalId ?? '')
  if (approvalId && existing.isPending) return <section className="page"><PageHeader title="Approval" /><Loading /></section>
  if (approvalId && existing.isError) return <section className="page"><ErrorCard error={existing.error} /></section>
  const approval = approvalId ? existing.data : undefined
  return <ApprovalForm key={approval?.id ?? 'new'} approval={approval} clientId={approval?.client_id ?? clientId ?? ''} />
}

function ApprovalForm({ approval, clientId }: { approval?: ApprovalWithBalance; clientId: string }) {
  const navigate = useNavigate()
  const invalidate = useInvalidate()
  const client = useClient(clientId)
  const insurers = useInsurers()
  const [insurer, setInsurer] = useState(approval?.insurer ?? '')
  const [serial, setSerial] = useState(approval?.serial_number ?? '')
  const [sessions, setSessions] = useState(numberText(approval?.sessions_approved))
  const [billed, setBilled] = useState(numberText(approval?.billed_per_session ?? DEFAULT_BILLED))
  const [copay, setCopay] = useState(numberText(approval?.copay_per_session ?? 0))
  const [approvedOn, setApprovedOn] = useState(approval?.approved_on ?? todayISO())
  const [validUntil, setValidUntil] = useState(approval?.valid_until ?? '')
  const [used, setUsed] = useState(numberText(approval?.sessions_used_before_app ?? 0))
  const [asOf, setAsOf] = useState(approval?.used_before_app_as_of ?? todayISO())
  const [status, setStatus] = useState<Status>(approval?.status ?? 'active')
  const [notes, setNotes] = useState(approval?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const back = `/clients/${clientId}`

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const n = parseNumber(sessions)
    const billedN = parseNumber(billed)
    const copayN = parseNumber(copay) ?? 0
    const usedN = parseNumber(used) ?? 0
    if (!insurer.trim()) return setError('Enter the insurer.')
    if (!n || n < 1 || !Number.isInteger(n)) return setError('Sessions approved must be a whole number of at least 1.')
    if (billedN === null || billedN < 0) return setError('Enter the amount billed per session.')
    if (copayN < 0) return setError('The co-pay can’t be negative.')
    if (!Number.isInteger(usedN) || usedN < 0 || usedN > n) return setError(`Sessions already used must be between 0 and ${n}.`)
    if (validUntil && approvedOn && validUntil < approvedOn) return setError('“Valid until” is before the approval date.')
    setSaving(true)
    setError(null)
    try {
      await saveApproval(approval?.id ?? null, {
        client_id: clientId,
        insurer: insurer.trim(),
        serial_number: serial.trim() || null,
        sessions_approved: n,
        billed_per_session: billedN,
        copay_per_session: copayN,
        approved_on: approvedOn || null,
        valid_until: validUntil || null,
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
    if (!approval || !window.confirm('Delete this approval? This cannot be undone.')) return
    try {
      await deleteApproval(approval.id)
      await invalidate.balances()
      navigate(back, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="page">
      <PageHeader title={approval ? 'Edit approval' : 'New insurance approval'} back={back} />
      {client.data && <p className="muted">{client.data.name}</p>}
      <form className="card form" onSubmit={onSubmit} noValidate>
        <div className="field-row">
          <Field label="Insurer">
            <input list="insurers" value={insurer} onChange={(e) => setInsurer(e.target.value)} autoCapitalize="words" />
            <datalist id="insurers">
              {insurers.data?.map((i) => <option key={i} value={i} />)}
            </datalist>
          </Field>
          <Field label="Serial number">
            <input value={serial} onChange={(e) => setSerial(e.target.value)} autoCapitalize="characters" />
          </Field>
        </div>

        <Field label="Sessions approved">
          <input inputMode="numeric" value={sessions} onChange={(e) => setSessions(e.target.value)} />
        </Field>

        <div className="field-row">
          <Field label="Billed per session ($)">
            <input inputMode="decimal" value={billed} onChange={(e) => setBilled(e.target.value)} />
          </Field>
          <Field label="Client co-pay ($)" hint="Paid by the client as “Insurance difference”.">
            <input inputMode="decimal" value={copay} onChange={(e) => setCopay(e.target.value)} />
          </Field>
        </div>

        <div className="field-row">
          <Field label="Approved on">
            <input type="date" value={approvedOn} onChange={(e) => setApprovedOn(e.target.value)} />
          </Field>
          <Field label="Valid until (optional)">
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>
        </div>

        <UsedBeforeFields used={used} asOf={asOf} onUsed={setUsed} onAsOf={setAsOf} />
        {approval && <SessionsSummary inApp={approval.sessions_used_in_app} remaining={approval.sessions_remaining} />}

        <StatusSelect value={status} onChange={setStatus} allowProposed={approval?.status === 'proposed'} />

        <Field label="Notes">
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="button primary block" disabled={saving || !clientId}>
          {saving ? 'Saving…' : 'Save approval'}
        </button>
        {approval && (
          <button type="button" className="button ghost danger block" onClick={onDelete}>
            Delete approval
          </button>
        )}
      </form>
    </section>
  )
}
