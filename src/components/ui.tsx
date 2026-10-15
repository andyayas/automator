import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { Status } from '../lib/api'

export function PageHeader({ title, back, action }: { title: string; back?: string; action?: ReactNode }) {
  return (
    <header className="page-header">
      {back && (
        <Link to={back} className="back-link" aria-label="Back">
          ‹ Back
        </Link>
      )}
      <div className="page-header-row">
        <h1>{title}</h1>
        {action}
      </div>
    </header>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="muted" aria-busy="true">
      {label}
    </p>
  )
}

export function ErrorCard({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div className="card error-card" role="alert">
      <p className="strong">Something went wrong</p>
      <p className="muted small">{message}</p>
      {retry && (
        <button type="button" className="button" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

export function Section({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>
          {title}
          {count !== undefined && <span className="count">{count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

type Tone = 'neutral' | 'accent' | 'warn' | 'danger'

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

const STATUS_TONE: Record<Status, Tone> = { proposed: 'warn', active: 'accent', finished: 'neutral', cancelled: 'neutral' }
const STATUS_LABEL: Record<Status, string> = { proposed: 'To review', active: 'Active', finished: 'Finished', cancelled: 'Cancelled' }

export function StatusBadge({ status }: { status: Status }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
}

/** "3 of 12 left", red at 0 or below, amber at the last session. */
export function RemainingBadge({ remaining, total }: { remaining: number; total: number }) {
  const tone: Tone = remaining <= 0 ? 'danger' : remaining <= 1 ? 'warn' : 'accent'
  return (
    <Badge tone={tone}>
      {remaining} of {total} left
    </Badge>
  )
}
