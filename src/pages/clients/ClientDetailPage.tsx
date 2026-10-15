import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { BalanceCard } from '../../components/BalanceCard'
import { Badge, Empty, ErrorCard, Loading, PageHeader, Section } from '../../components/ui'
import { deleteAlias } from '../../lib/api'
import { formatDate, formatMoney } from '../../lib/format'
import { formatPhone } from '../../lib/phone'
import { useAliases, useApprovals, useClient, useClientSessions, useInvalidate, usePackages } from '../../lib/queries'

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
      </Section>
    </section>
  )
}
