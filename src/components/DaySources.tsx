import { useState, type FormEvent } from 'react'
import { PasswordNeeded, cashSummary, prepareCashUpload, saveCashUpload } from '../lib/cash-upload'
import { formatDate, todayISO } from '../lib/format'
import { useInvalidate, useLatestCashDate } from '../lib/queries'

type Loaded = { name: string; bytes: Uint8Array }
type State =
  | { kind: 'idle' }
  | { kind: 'busy'; label: string }
  | { kind: 'password'; file: Loaded; wrong: boolean }
  | { kind: 'done'; text: string }
  | { kind: 'error'; text: string }

/** Step 1 of the daily review: upload the cash statement without leaving the page. */
export function DaySources({ date }: { date: string }) {
  const latest = useLatestCashDate()
  const invalidate = useInvalidate()
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [password, setPassword] = useState('')
  const [dragging, setDragging] = useState(false)

  const behind = latest.isFetched && (latest.data ?? '') < date && date <= todayISO()

  async function upload(file: Loaded, typed: string | null) {
    setState({ kind: 'busy', label: 'Reading the file…' })
    try {
      const prepared = await prepareCashUpload(file, typed, (label) => setState({ kind: 'busy', label }))
      setState({ kind: 'busy', label: 'Saving…' })
      await saveCashUpload(prepared)
      await Promise.all([invalidate.day(), invalidate.balances()])
      setPassword('')
      setState({ kind: 'done', text: cashSummary(prepared.plan) })
    } catch (err) {
      if (err instanceof PasswordNeeded) return setState({ kind: 'password', file, wrong: err.wrong })
      setState({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div className="day-sources">
      <label
        className={`drop-zone ${behind ? 'behind' : ''} ${dragging ? 'dragging' : ''} ${state.kind === 'busy' ? 'busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={async (e) => {
          e.preventDefault()
          setDragging(false)
          const f = e.dataTransfer.files[0]
          if (f && state.kind !== 'busy') void upload({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }, null)
        }}
      >
        <span className="drop-zone-title">
          {state.kind === 'busy' ? state.label : 'Upload the cash statement. Tap to choose.'}
        </span>
        <span className={`small ${behind ? 'warn-text' : 'muted'}`}>
          {latest.data ? `In the app up to ${formatDate(latest.data, { short: true })}` : latest.isFetched ? 'Not uploaded yet' : ''}
          {behind ? ': upload today’s file' : ''}
        </span>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={state.kind === 'busy'}
          aria-label="Upload the cash statement"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void upload({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }, null)
          }}
        />
      </label>

      {state.kind === 'done' && <p className="muted small">✓ {state.text}</p>}
      {state.kind === 'error' && (
        <p className="error small" role="alert">
          {state.text}
        </p>
      )}
      {state.kind === 'password' && (
        <form
          className="inline-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (password) void upload(state.file, password)
          }}
        >
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={state.wrong ? 'The password changed: type the new one' : 'File password (asked once)'}
            aria-label="Cash statement password"
            autoComplete="off"
            autoFocus
          />
          <button type="submit" className="button" disabled={!password}>
            Unlock
          </button>
        </form>
      )}

    </div>
  )
}
