import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { BalanceCard } from '../../components/BalanceCard'
import { Badge, Empty, ErrorCard, Loading, PageHeader, Section } from '../../components/ui'
import { deleteAlias, linkNameVariant, mergeClients } from '../../lib/api'
import { formatDate, formatMoney } from '../../lib/format'
import { normalizeName } from '../../lib/names'
import { formatPhone } from '../../lib/phone'
import { useAliases, useApprovals, useClient, useClients, useClientSessions, useInvalidate, usePackages } from '../../lib/queries'
import { searchClients } from '../../lib/search'

const BILLING_LABEL: Record<string, string> = {
  insurance: 'Insurance',
  package: 'Package',
  per_session: 'Per session',
  free: 'Free',
}

export function ClientDetailPage() {
  const { clientId = '' } = useParams()
  const client = useClient(clientId)
  const packages = usePackages()
  const approvals = useApprovals()
  const aliases = useAliases(clientId)
  const sessions = useClientSessions(clientId)
  const invalidate = useInvalidate()
  const [aliasError, setAliasError] = useState<string | null>(null)
  const [newAlias, setNewAlias] = useState('')
  const [merging, setMerging] = useState(false)

  async function onAddAlias(event: FormEvent) {
    event.preventDefault()
    const alias = normalizeName(newAlias)
    if (!alias) return
    try {
      setAliasError(null)
      await linkNameVariant(clientId, alias)
      setNewAlias('')
      await invalidate.client(clientId)
    } catch (err) {
      setAliasError(err instanceof Error ? err.message : String(err))
    }
  }

  if (client.isPending) return <section className="page"><PageHeader title="Client" back="/clients" /><Loading /></section>
  if (client.isError) {
    return (
      <section className="page">
        <PageHeader title="Client" back="/clients" />
        <ErrorCard error={client.error} retry={() => void client.refetch()} />
      </section>
    )
  }

  const c = client.data
  const pkgs = (packages.data ?? []).filter((p) => p.client_id === clientId)
  const apps = (approvals.data ?? []).filter((a) => a.client_id === clientId)
  const phoneSource = c.phone_override ? 'Fixed by you' : c.phone_contacts ? 'From Contacts' : null

  return (
    <section className="page">
      <PageHeader
        title={c.name}
        back="/clients"
        action={
          <Link className="button" to={`/clients/${clientId}/edit`}>
            Edit
          </Link>
        }
      />

      <div className="card">
        <div className="list-row flush">
          <span>
            <span className="strong block">{c.phone ? formatPhone(c.phone) : 'No phone'}</span>
            {phoneSource && <span className="muted small">{phoneSource}</span>}
          </span>
          {c.phone && (
            <a className="button" href={`https://wa.me/${c.phone}`} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          )}
        </div>
        {!c.active && <Badge>Inactive</Badge>}
        {c.notes && <p className="note">{c.notes}</p>}
      </div>

      <Section
        title="Packages"
        action={
          <Link className="button" to={`/clients/${clientId}/packages/new`}>
            Add
          </Link>
        }
      >
        {packages.isPending ? (
          <Loading />
        ) : pkgs.length ? (
          <div className="stack">
            {pkgs.map((p) => (
              <BalanceCard key={p.id} kind="package" item={p} />
            ))}
          </div>
        ) : (
          <Empty>No packages.</Empty>
        )}
      </Section>

      <Section
        title="Insurance approvals"
        action={
          <Link className="button" to={`/clients/${clientId}/approvals/new`}>
            Add
          </Link>
        }
      >
        {approvals.isPending ? (
          <Loading />
        ) : apps.length ? (
          <div className="stack">
            {apps.map((a) => (
              <BalanceCard key={a.id} kind="approval" item={a} />
            ))}
          </div>
        ) : (
          <Empty>No approvals.</Empty>
        )}
      </Section>

      <Section title="Session history">
        {sessions.isPending ? (
          <Loading />
        ) : sessions.data?.length ? (
          <div className="card list">
            {sessions.data.map((s) => (
              <div key={s.id} className="list-row">
                <span>
                  <span className="block">{formatDate(s.date)}</span>
                  <span className="muted small">
                    {BILLING_LABEL[s.billing_type] ?? s.billing_type}
                    {s.therapist ? ` · ${s.therapist}` : ''}
                  </span>
                </span>
                <span className="muted small">
                  {formatMoney(s.collected)} / {formatMoney(s.billed)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No confirmed sessions yet. They appear here once you confirm days in the daily review.</Empty>
        )}
      </Section>

      <Section title="Name variants">
        <p className="muted small">
          Spellings the app has learned for this client from the schedule and cash statement.
        </p>
        {aliasError && <p className="error" role="alert">{aliasError}</p>}
        {aliases.data?.length ? (
          <div className="card list">
            {aliases.data.map((a) => (
              <div key={a.id} className="list-row">
                <span>{a.alias}</span>
                <button
                  type="button"
                  className="button ghost danger"
                  onClick={async () => {
                    if (!window.confirm(`Forget "${a.alias}" for this client?`)) return
                    try {
                      setAliasError(null)
                      await deleteAlias(a.id)
                      await invalidate.client(clientId)
                    } catch (err) {
                      setAliasError(err instanceof Error ? err.message : String(err))
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty>None yet.</Empty>
        )}
        <form className="inline-form" onSubmit={onAddAlias}>
          <input
            value={newAlias}
            onChange={(e) => setNewAlias(e.target.value)}
            placeholder="Another spelling, e.g. from the cash statement"
            aria-label="Add a name variant"
            autoCapitalize="none"
            autoComplete="off"
          />
          <button type="submit" className="button" disabled={!newAlias.trim()}>
            Add
          </button>
        </form>
      </Section>

      <Section title="Duplicate?">
        <p className="muted small">If this person is in the app twice, merge the other copy into this one.</p>
        <button type="button" className="button block" onClick={() => setMerging(true)}>
          Merge a duplicate into {c.name}
        </button>
      </Section>
      {merging && <MergeDialog keep={c} onClose={() => setMerging(false)} />}
    </section>
  )
}

function MergeDialog({ keep, onClose }: { keep: { id: string; name: string }; onClose: () => void }) {
  const clients = useClients()
  const invalidate = useInvalidate()
  const navigate = useNavigate()
  const dialog = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => dialog.current?.showModal(), [])
  const results = useMemo(
    () => searchClients((clients.data ?? []).filter((x) => x.id !== keep.id), query).results,
    [clients.data, query, keep.id],
  )

  async function merge(dup: { id: string; name: string }) {
    if (!window.confirm(`Move everything from "${dup.name}" into "${keep.name}" and delete "${dup.name}"? This can't be undone.`)) return
    setBusy(true)
    setError(null)
    try {
      await mergeClients(keep.id, dup.id, normalizeName(dup.name))
      await Promise.all([invalidate.clients(), invalidate.client(keep.id), invalidate.balances(), invalidate.schedule(), invalidate.day()])
      onClose()
      navigate(`/clients/${keep.id}`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <dialog ref={dialog} className="sheet" onClose={onClose} aria-label={`Merge a duplicate into ${keep.name}`}>
      <div className="sheet-head">
        <div>
          <p className="muted small">Keep</p>
          <p className="strong">{keep.name}</p>
        </div>
        <button type="button" className="button ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="muted small">Find the other copy. Its packages, approvals, sessions, bookings, payments and spellings move here.</p>
      <input className="search" type="search" placeholder="Search the duplicate" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      {error && <p className="error" role="alert">{error}</p>}
      <div className="card list sheet-list">
        {results.map((x) => (
          <button key={x.id} type="button" className="list-row link as-button" disabled={busy} onClick={() => merge(x)}>
            <span className="row-text">
              <span className="strong">{x.name}</span>
              <span className="muted small">{x.phone ? formatPhone(x.phone) : 'No phone'}</span>
            </span>
            <span className="chevron">›</span>
          </button>
        ))}
        {query && !results.length && <p className="empty pad">No client found.</p>}
      </div>
    </dialog>
  )
}
