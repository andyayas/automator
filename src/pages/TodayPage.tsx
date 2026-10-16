import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { BalanceCard } from '../components/BalanceCard'
import { DailyReviewCard } from '../components/DailyReviewCard'
import { Empty, ErrorCard, Loading, PageHeader, Section } from '../components/ui'
import { deleteApproval, deletePackage, setStatus, type ApprovalWithBalance, type PackageWithBalance } from '../lib/api'
import { balanceAlerts } from '../lib/alerts'
import { todayISO } from '../lib/format'
import { useApprovals, useClients, useInvalidate, usePackages } from '../lib/queries'

export function TodayPage() {
  const packages = usePackages()
  const approvals = useApprovals()
  const clients = useClients()
  const invalidate = useInvalidate()
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const today = todayISO()
  const heading = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  if (packages.isPending || approvals.isPending) return <TodayFrame heading={heading}><Loading /></TodayFrame>
  if (packages.isError || approvals.isError) {
    return (
      <TodayFrame heading={heading}>
        <ErrorCard error={packages.error ?? approvals.error} retry={() => void invalidate.balances()} />
      </TodayFrame>
    )
  }

  const pkgs = packages.data
  const apps = approvals.data
  const proposed = [
    ...pkgs.filter((p) => p.status === 'proposed').map((p) => ({ kind: 'package' as const, item: p })),
    ...apps.filter((a) => a.status === 'proposed').map((a) => ({ kind: 'approval' as const, item: a })),
  ]
  const alerts = balanceAlerts(pkgs, apps, today)
  const byRemaining = <T extends { sessions_remaining: number }>(a: T, b: T) => a.sessions_remaining - b.sessions_remaining
  const activePackages = pkgs.filter((p) => p.status === 'active').sort(byRemaining)
  const activeApprovals = apps.filter((a) => a.status === 'active').sort(byRemaining)
  const noClients = clients.data?.length === 0

  async function act(id: string, action: () => Promise<void>) {
    setBusy(id)
    setActionError(null)
    try {
      await action()
      await invalidate.balances()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const reviewActions = (kind: 'package' | 'approval', item: PackageWithBalance | ApprovalWithBalance) => (
    <>
      <button
        type="button"
        className="button primary"
        disabled={busy === item.id}
        onClick={() => act(item.id, () => setStatus(kind, item.id, 'active'))}
      >
        Accept
      </button>
      <Link className="button" to={kind === 'package' ? `/packages/${item.id}` : `/approvals/${item.id}`}>
        Edit
      </Link>
      <button
        type="button"
        className="button ghost danger"
        disabled={busy === item.id}
        onClick={() => {
          if (window.confirm('Discard this proposal? It has not counted for anything yet.')) {
            void act(item.id, () => (kind === 'package' ? deletePackage(item.id) : deleteApproval(item.id)))
          }
        }}
      >
        Discard
      </button>
    </>
  )

  return (
    <TodayFrame heading={heading}>
      {actionError && <p className="error" role="alert">{actionError}</p>}

      <Section title="Daily review">
        <DailyReviewCard />
      </Section>

      {noClients && (
        <div className="card">
          <p className="strong">No clients yet</p>
          <p className="muted">Import them from the schedule's Contacts tab to get started.</p>
          <Link className="button primary block" to="/more/import-contacts">
            Import clients
          </Link>
        </div>
      )}

      {proposed.length > 0 && (
        <Section title="Needs your review" count={proposed.length}>
          <p className="muted small">These count for nothing until you accept them.</p>
          <div className="stack">
            {proposed.map(({ kind, item }) =>
              kind === 'package' ? (
                <BalanceCard key={item.id} kind="package" item={item} showClient>
                  {reviewActions(kind, item)}
                </BalanceCard>
              ) : (
                <BalanceCard key={item.id} kind="approval" item={item} showClient>
                  {reviewActions(kind, item)}
                </BalanceCard>
              ),
            )}
          </div>
        </Section>
      )}

      {alerts.length > 0 && (
        <Section title="Alerts" count={alerts.length}>
          <div className="card list">
            {alerts.map((a) => {
              const v = a.item.value
              const path = a.item.type === 'package' ? `/packages/${v.id}` : `/approvals/${v.id}`
              const what = a.item.type === 'package' ? 'Package' : a.item.value.insurer
              return (
                <Link key={`${a.kind}-${v.id}`} to={path} className={`list-row link alert-${a.kind}`}>
                  <span>
                    <span className="strong">{v.client?.name ?? 'Unknown client'}</span>
                    <span className="muted small block">{what}</span>
                  </span>
                  <span className={`alert-text ${a.kind}`}>{a.message}</span>
                </Link>
              )
            })}
          </div>
        </Section>
      )}

      <Section title="Active packages" count={activePackages.length}>
        {activePackages.length ? (
          <div className="stack">
            {activePackages.map((p) => (
              <BalanceCard key={p.id} kind="package" item={p} showClient hideNotes />
            ))}
          </div>
        ) : (
          <Empty>No active packages.</Empty>
        )}
      </Section>

      <Section title="Active insurance approvals" count={activeApprovals.length}>
        {activeApprovals.length ? (
          <div className="stack">
            {activeApprovals.map((a) => (
              <BalanceCard key={a.id} kind="approval" item={a} showClient hideNotes />
            ))}
          </div>
        ) : (
          <Empty>No active approvals.</Empty>
        )}
      </Section>
    </TodayFrame>
  )
}

function TodayFrame({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="page">
      <PageHeader title={heading} />
      {children}
    </section>
  )
}
