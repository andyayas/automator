import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Badge, Empty, ErrorCard, Loading, PageHeader, RemainingBadge } from '../../components/ui'
import type { ApprovalWithBalance, PackageWithBalance } from '../../lib/api'
import { daysBetween, formatDate, formatMoney, todayISO } from '../../lib/format'
import { normalizeName } from '../../lib/names'
import { formatPhone } from '../../lib/phone'
import { useApprovals, useClients, usePackages } from '../../lib/queries'
import { searchClients } from '../../lib/search'

type Tab = 'packages' | 'insurance' | 'all'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'packages', label: 'Packages' },
  { id: 'insurance', label: 'Insurance' },
  { id: 'all', label: 'All clients' },
]

/** Clients: who is on a package, who is on insurance, and everyone. */
export function ClientsPage() {
  const [params, setParams] = useSearchParams()
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'packages') as Tab
  const [query, setQuery] = useState('')

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
      <div className="tabs" role="tablist" aria-label="Client lists">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setParams({ tab: t.id }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <input
        className="search"
        type="search"
        placeholder={tab === 'all' ? 'Search all clients by name or phone' : 'Filter by name'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search clients"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {tab === 'packages' && <PackagesTab query={query} />}
      {tab === 'insurance' && <InsuranceTab query={query} />}
      {tab === 'all' && <AllClientsTab query={query} />}
    </section>
  )
}

const matches = (name: string | undefined, query: string) => {
  const words = normalizeName(query).split(' ').filter(Boolean)
  const nameWords = normalizeName(name).split(' ')
  return words.every((w) => nameWords.some((n) => n.startsWith(w)))
}

/** Active and to-review first (fewest sessions left first), then the rest if asked. */
function useSorted<T extends PackageWithBalance | ApprovalWithBalance>(items: T[] | undefined, query: string, showOld: boolean) {
  return useMemo(() => {
    const rank = { proposed: 0, active: 1, finished: 2, cancelled: 3 } as const
    return (items ?? [])
      .filter((i) => showOld || i.status === 'active' || i.status === 'proposed')
      .filter((i) => !query.trim() || matches(i.client?.name, query))
      .sort((a, b) => rank[a.status] - rank[b.status] || a.sessions_remaining - b.sessions_remaining)
  }, [items, query, showOld])
}

function PackagesTab({ query }: { query: string }) {
  const packages = usePackages()
  const [showOld, setShowOld] = useState(false)
  const list = useSorted(packages.data, query, showOld)
  if (packages.isPending) return <Loading />
  if (packages.isError) return <ErrorCard error={packages.error} retry={() => void packages.refetch()} />
  return (
    <>
      <ListHeader count={list.length} noun="package" showOld={showOld} onToggle={() => setShowOld((v) => !v)} />
      {list.length ? (
        <div className="card list">
          {list.map((p) => (
            <Link key={p.id} to={`/clients/${p.client_id}`} className="list-row link">
              <span className="row-text min0">
                <span className="strong truncate">{p.client?.name ?? 'Unknown client'}</span>
                <span className="muted small">
                  {p.sessions_total} sessions · {formatMoney(p.price_total)}
                  {p.purchased_on ? ` · bought ${formatDate(p.purchased_on, { short: true })}` : ''}
                  {p.amount_paid !== null && Number(p.amount_paid) < Number(p.price_total) ? ' · not fully paid' : ''}
                </span>
              </span>
              <StatusOrRemaining item={p} total={p.sessions_total} />
            </Link>
          ))}
        </div>
      ) : (
        <Empty>{query ? 'No package matches that name.' : 'No active packages.'}</Empty>
      )}
    </>
  )
}

function InsuranceTab({ query }: { query: string }) {
  const approvals = useApprovals()
  const [showOld, setShowOld] = useState(false)
  const list = useSorted(approvals.data, query, showOld)
  const today = todayISO()
  if (approvals.isPending) return <Loading />
  if (approvals.isError) return <ErrorCard error={approvals.error} retry={() => void approvals.refetch()} />
  return (
    <>
      <ListHeader count={list.length} noun="approval" showOld={showOld} onToggle={() => setShowOld((v) => !v)} />
      {list.length ? (
        <div className="card list">
          {list.map((a) => {
            const days = a.valid_until ? daysBetween(today, a.valid_until) : null
            return (
              <Link key={a.id} to={`/clients/${a.client_id}`} className="list-row link">
                <span className="row-text min0">
                  <span className="strong truncate">{a.client?.name ?? 'Unknown client'}</span>
                  <span className="muted small">
                    {a.insurer}
                    {a.serial_number ? ` · #${a.serial_number}` : ''}
                    {a.valid_until ? ` · until ${formatDate(a.valid_until, { short: true })}` : ''}
                  </span>
                </span>
                <span className="badges stacked">
                  {days !== null && a.status === 'active' && days < 0 && <Badge tone="danger">Expired</Badge>}
                  {days !== null && a.status === 'active' && days >= 0 && days <= 7 && <Badge tone="warn">Expires soon</Badge>}
                  <StatusOrRemaining item={a} total={a.sessions_approved} />
                </span>
              </Link>
            )
          })}
        </div>
      ) : (
        <Empty>
          {query
            ? 'No approval matches that name.'
            : 'No active approvals. Add one from the client’s page (All clients → the client → Insurance approvals → Add).'}
        </Empty>
      )}
    </>
  )
}

function StatusOrRemaining({ item, total }: { item: PackageWithBalance | ApprovalWithBalance; total: number }) {
  if (item.status === 'active') return <RemainingBadge remaining={item.sessions_remaining} total={total} />
  if (item.status === 'proposed') return <Badge tone="accent">To review</Badge>
  return <Badge>{item.status === 'finished' ? 'Finished' : 'Cancelled'}</Badge>
}

function ListHeader({ count, noun, showOld, onToggle }: { count: number; noun: string; showOld: boolean; onToggle: () => void }) {
  return (
    <div className="list-header">
      <span className="muted small">
        {count} {noun}
        {count === 1 ? '' : 's'}
        {showOld ? '' : ' (active and to review)'}
      </span>
      <button type="button" className="button ghost small-button" onClick={onToggle}>
        {showOld ? 'Hide finished' : 'Show finished'}
      </button>
    </div>
  )
}

function AllClientsTab({ query }: { query: string }) {
  const clients = useClients()
  const packages = usePackages()
  const approvals = useApprovals()

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

  const search = useMemo(() => searchClients(clients.data ?? [], query, new Set(active.keys())), [clients.data, query, active])

  if (clients.isPending) return <Loading />
  if (clients.isError) return <ErrorCard error={clients.error} retry={() => void clients.refetch()} />
  if (!clients.data.length) {
    return (
      <div className="card">
        <p className="strong">No clients yet</p>
        <p className="muted">Import them from the clinic phone’s contacts (More → Import clients).</p>
        <Link className="button primary block" to="/more/import-contacts">
          Import clients
        </Link>
      </div>
    )
  }
  if (!query.trim()) return <p className="muted small">{clients.data.length} clients. Type a name or phone number to find one.</p>

  return (
    <>
      {search.fuzzy && search.results.length > 0 && <p className="muted small">No exact match. Did you mean:</p>}
      {search.results.length > 0 ? (
        <div className="card list">
          {search.results.map((c) => {
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
        <Empty>No client found. Check the spelling, or add them.</Empty>
      )}
      {search.total > search.results.length && (
        <p className="muted small center">
          Showing {search.results.length} of {search.total}. Type more to narrow it down.
        </p>
      )}
    </>
  )
}
