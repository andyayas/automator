import { useEffect, useMemo, useRef, useState } from 'react'
import type { BookingStatus } from '../lib/schedule-cell'
import { createClientRecord } from '../lib/api'
import { formatPhone } from '../lib/phone'
import { displayName, normalizeName } from '../lib/names'
import { useClients, useInvalidate } from '../lib/queries'
import { linkCashName } from '../lib/day-api'
import { linkNameToClient } from '../lib/schedule-api'
import { searchClients } from '../lib/search'
import { openDialog } from '../lib/dialog'

const STATUS: Record<BookingStatus, { letter: string; label: string; tone: string }> = {
  confirmed: { letter: 'C', label: 'Confirmed', tone: 'accent' },
  cancelled: { letter: 'X', label: 'Cancelled', tone: 'danger' },
  rescheduled: { letter: 'R', label: 'Rescheduled', tone: 'warn' },
  unknown: { letter: '?', label: 'No status yet', tone: 'neutral' },
}

export function StatusChip({ status }: { status: string }) {
  const s = STATUS[(status as BookingStatus) in STATUS ? (status as BookingStatus) : 'unknown']
  return (
    <span className={`status-chip ${s.tone}`} title={s.label} aria-label={s.label}>
      {s.letter}
    </span>
  )
}

/** Previous / next day, plus a date picker. */
export function DateNav({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const shift = (days: number) => {
    const d = new Date(`${date}T00:00:00`)
    d.setDate(d.getDate() + days)
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  const label = new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <div className="date-nav">
      <button type="button" className="button icon" onClick={() => shift(-1)} aria-label="Previous day">
        ‹
      </button>
      <label className="date-nav-label">
        <span>{label}</span>
        <input type="date" value={date} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label="Pick a date" />
      </label>
      <button type="button" className="button icon" onClick={() => shift(1)} aria-label="Next day">
        ›
      </button>
    </div>
  )
}

/**
 * "Who is this?" for a name on the schedule: pick the client (the spelling is
 * remembered from then on) or add them as a new client.
 */
export function LinkClientDialog({
  name,
  suggestedId,
  onClose,
}: {
  name: string
  suggestedId?: string | null
  onClose: () => void
}) {
  const clients = useClients()
  const invalidate = useInvalidate()
  const [query, setQuery] = useState(name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => openDialog(dialog.current), [])

  const results = useMemo(() => {
    const all = clients.data ?? []
    const found = searchClients(all, query).results
    const suggested = suggestedId ? all.find((c) => c.id === suggestedId) : undefined
    return suggested ? [suggested, ...found.filter((c) => c.id !== suggested.id)] : found
  }, [clients.data, query, suggestedId])

  async function link(clientId: string) {
    setBusy(true)
    setError(null)
    try {
      await linkNameToClient(normalizeName(name), clientId)
      // Payments written under this spelling count for the client too.
      await linkCashName(normalizeName(name), clientId, normalizeName)
      await Promise.all([invalidate.schedule(), invalidate.day(), invalidate.client(clientId)])
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  async function addNew() {
    setBusy(true)
    setError(null)
    try {
      const created = await createClientRecord({ name: displayName(name), notes: 'Added from the schedule. Phone unknown.' })
      await invalidate.clients()
      await link(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <dialog ref={dialog} tabIndex={-1} className="sheet" onClose={onClose} aria-label={`Who is ${name}?`}>
      <div className="sheet-head">
        <div>
          <p className="muted small">On the schedule as</p>
          <p className="strong">{name}</p>
        </div>
        <button type="button" className="button ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <input
        className="search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search clients"
        autoComplete="off"
      />
      {error && <p className="error" role="alert">{error}</p>}
      <div className="card list sheet-list">
        {results.map((c) => (
          <button key={c.id} type="button" className="list-row link as-button" disabled={busy} onClick={() => link(c.id)}>
            <span className="row-text">
              <span className="strong">
                {c.name}
                {c.id === suggestedId ? ' (suggested)' : ''}
              </span>
              <span className="muted small">{c.phone ? formatPhone(c.phone) : 'No phone'}</span>
            </span>
            <span className="chevron">›</span>
          </button>
        ))}
        {!results.length && <p className="empty pad">No client found.</p>}
      </div>
      <button type="button" className="button block" disabled={busy} onClick={addNew}>
        Not in the list: add “{displayName(name)}” as a new client
      </button>
      <p className="muted small">The app remembers this spelling, so you only do this once per name.</p>
    </dialog>
  )
}
