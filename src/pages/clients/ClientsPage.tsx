import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Badge, Empty, ErrorCard, Loading, PageHeader } from '../../components/ui'
import { formatPhone } from '../../lib/phone'
import { useApprovals, useClients, usePackages } from '../../lib/queries'
import { searchClients } from '../../lib/search'

export function ClientsPage() {
  const clients = useClients()
  const packages = usePackages()
  const approvals = useApprovals()
  const [query, setQuery] = useState('')

  // Sessions left per client across active packages / approvals, for the badges.
  const active = useMemo(() => {
    const map = new Map<string, { pkg?: number; ins?: number }>()
    for (const p of packages.data ?? []) {
      if (p.status !== 'active' || !p.client_id) continue
      const e = map.get(p.client_id) ?? {}
      e.pkg = (e.pkg ?? 0) + p.sessions_remaining
      map.set(p.client_id, e)
    }
    for (const a of approvals.data ?? []) {
      if (a.status !== 'active' || !a.client_id) continue
      const e = map.get(a.client_id) ?? {}
      e.ins = (e.ins ?? 0) + a.sessions_remaining
      map.set(a.client_id, e)
    }
    return map
  }, [packages.data, approvals.data])

  const search = useMemo(
    () => searchClients(clients.data ?? [], query, new Set(active.keys())),
    [clients.data, query, active],
  )

  // With an empty search box, list the clients who have something active.
  const shown = query.trim()
    ? search.results
    : (clients.data ?? []).filter((c) => active.has(c.id))

  return (
    <section className="page">
      <PageHeader
        title="Clients"
        action={
          <Link className="button" to="/clients/new">
            Add
          </Link>
        }
      />

      <input
        className="search"
        type="search"
        placeholder={clients.data ? `Search ${clients.data.length} clients by name or phone` : 'Search clients'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search clients"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />

      {clients.isPending && <Loading />}
      {clients.isError && <ErrorCard error={clients.error} retry={() => void clients.refetch()} />}

      {clients.data && clients.data.length === 0 && (
        <div className="card">
          <p className="strong">No clients yet</p>
          <p className="muted">Import them from the schedule's Contacts tab.</p>
          <Link className="button primary block" to="/more/import-contacts">
            Import clients
          </Link>
        </div>
      )}

      {clients.data && clients.data.length > 0 && (
        <>
          {!query.trim() && <p className="muted small">Clients with an active package or approval:</p>}
          {query.trim() && search.fuzzy && search.results.length > 0 && (
            <p className="muted small">No exact match. Did you mean:</p>
          )}
          {shown.length > 0 ? (
            <div className="card list">
              {shown.map((c) => {
                const a = active.get(c.id)
                return (
                  <Link key={c.id} to={`/clients/${c.id}`} className="list-row link">
                    <span className="min0">
                      <span className="strong block truncate">{c.name}</span>
                      <span className="muted small">{c.phone ? formatPhone(c.phone) : 'No phone'}</span>
                    </span>
                    <span className="badges">
                      {a?.pkg !== undefined && <Badge tone={a.pkg <= 1 ? 'warn' : 'accent'}>Pkg {a.pkg}</Badge>}
                      {a?.ins !== undefined && <Badge tone={a.ins <= 1 ? 'warn' : 'accent'}>Ins {a.ins}</Badge>}
                      {!c.active && <Badge>Inactive</Badge>}
                    </span>
                  </Link>
                )
              })}
            </div>
          ) : (
            <Empty>{query.trim() ? 'No client found. Check the spelling, or add them.' : 'Nobody has an active package or approval yet.'}</Empty>
          )}
          {query.trim() && search.total > search.results.length && (
            <p className="muted small center">
              Showing {search.results.length} of {search.total}. Type more to narrow it down.
            </p>
          )}
        </>
      )}
    </section>
  )
}
