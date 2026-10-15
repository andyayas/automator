import type { ReactNode } from 'react'
import type { Status } from '../../lib/api'
import { parseNumber } from '../../lib/format'

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>
        <span>{label}</span>
        {children}
      </label>
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

const STATUS_OPTIONS: Array<{ value: Status; label: string }> = [
  { value: 'proposed', label: 'To review (counts for nothing yet)' },
  { value: 'active', label: 'Active' },
  { value: 'finished', label: 'Finished' },
  { value: 'cancelled', label: 'Cancelled' },
]

export function StatusSelect({ value, onChange, allowProposed }: { value: Status; onChange: (s: Status) => void; allowProposed: boolean }) {
  return (
    <Field label="Status">
      <select value={value} onChange={(e) => onChange(e.target.value as Status)}>
        {STATUS_OPTIONS.filter((o) => allowProposed || o.value !== 'proposed').map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

/** "Sessions already used" plus the date that count runs to. */
export function UsedBeforeFields(props: {
  used: string
  asOf: string
  onUsed: (v: string) => void
  onAsOf: (v: string) => void
}) {
  const showAsOf = (parseNumber(props.used) ?? 0) > 0
  return (
    <div className="field-row">
      <Field label="Sessions already used" hint="Used before the app started counting.">
        <input inputMode="numeric" value={props.used} onChange={(e) => props.onUsed(e.target.value)} />
      </Field>
      {showAsOf && (
        <Field label="Counted up to (including)">
          <input type="date" value={props.asOf} onChange={(e) => props.onAsOf(e.target.value)} />
        </Field>
      )}
    </div>
  )
}

export function SessionsSummary({ inApp, remaining }: { inApp: number; remaining: number }) {
  return (
    <p className="muted small">
      Confirmed in the app: {inApp} · Left now: <span className="strong">{remaining}</span>
    </p>
  )
}
