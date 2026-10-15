import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '../components/ui'
import { fetchAllClients, fetchInsurers } from '../lib/api'
import { applyCashImport, fetchPackageKeys, fetchStoredCash } from '../lib/cash-api'
import { planCashImport, proposalStartDate, type CashImportPlan } from '../lib/cash-import'
import { formatDate, formatMoney, plural, todayISO } from '../lib/format'
import { createNameMatcher } from '../lib/names'
import { useInvalidate } from '../lib/queries'
import { fetchAllAliases } from '../lib/schedule-api'

// The password is only ever kept in this browser, and only if she ticks the box.
const PASSWORD_KEY = 'clinic-admin.cash-password'
const readSaved = () => {
  try {
    return localStorage.getItem(PASSWORD_KEY) ?? ''
  } catch {
    return ''
  }
}
const writeSaved = (value: string | null) => {
  try {
    if (value) localStorage.setItem(PASSWORD_KEY, value)
    else localStorage.removeItem(PASSWORD_KEY)
  } catch {
    // Storage unavailable (private mode): nothing to remember.
  }
}

type Loaded = { name: string; bytes: Uint8Array }
type Step =
  | { kind: 'pick' }
  | { kind: 'password'; file: Loaded; wrong: boolean }
  | { kind: 'working'; label: string }
  | { kind: 'preview'; fileName: string; plan: CashImportPlan; fixedDates: string[]; rows: number }
  | { kind: 'done'; plan: CashImportPlan }

/** More → Upload cash statement. The file is decrypted and read on this device. */
export function CashImportPage() {
  const invalidate = useInvalidate()
  const [step, setStep] = useState<Step>({ kind: 'pick' })
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState(readSaved)
  const [remember, setRemember] = useState(Boolean(readSaved()))

  const fail = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    setError(/dynamically imported module|module script failed/i.test(message) ? 'The app was just updated. Reload the page and try again.' : message)
    setStep({ kind: 'pick' })
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    const loaded = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
    const { isEncryptedOfficeFile } = await import('../lib/office-crypto')
    if (!isEncryptedOfficeFile(loaded.bytes)) return void read(loaded, null)
    if (password) return void read(loaded, password)
    setStep({ kind: 'password', file: loaded, wrong: false })
  }

  async function read(file: Loaded, pw: string | null) {
    setError(null)
    try {
      const [{ read: readXlsx }, crypto, { parseCashStatement }] = await Promise.all([
        import('xlsx'),
        import('../lib/office-crypto'),
        import('../lib/cash-statement'),
      ])
      let bytes = file.bytes
      if (pw !== null) {
        setStep({ kind: 'working', label: 'Unlocking the file (a few seconds)…' })
        try {
          bytes = await crypto.decryptOfficeFile(file.bytes, pw)
        } catch (err) {
          if (err instanceof crypto.WrongPasswordError) {
            writeSaved(null)
            setPassword('')
            return setStep({ kind: 'password', file, wrong: true })
          }
          throw err
        }
        writeSaved(remember ? pw : null)
      }
      setStep({ kind: 'working', label: 'Reading the transactions…' })
      const insurers = [...(await fetchInsurers()), 'nextcare']
      const parsed = parseCashStatement(readXlsx(bytes, { type: 'array', cellDates: true }), { insurers })
      if (!parsed.rows.length) throw new Error('No transactions found. Is this the cash statement?')
      const [clients, aliases, stored, packages] = await Promise.all([fetchAllClients(), fetchAllAliases(), fetchStoredCash(), fetchPackageKeys()])
      const names = new Map(clients.map((c) => [c.id, c.name]))
      const plan = planCashImport(
        parsed.rows,
        stored,
        createNameMatcher(clients, aliases),
        (id) => names.get(id) ?? id,
        packages,
        proposalStartDate(stored.map((s) => s.date), todayISO()),
      )
      setStep({ kind: 'preview', fileName: file.name, plan, fixedDates: parsed.fixedDates, rows: parsed.rows.length })
    } catch (err) {
      fail(err)
    }
  }

  async function onImport(fileName: string, plan: CashImportPlan, fixedDates: string[]) {
    setStep({ kind: 'working', label: 'Saving…' })
    try {
      await applyCashImport(plan, fileName, fixedDates)
      await invalidate.balances()
      setStep({ kind: 'done', plan })
    } catch (err) {
      fail(err)
    }
  }

  return (
    <section className="page">
      <PageHeader title="Upload cash statement" back="/more" />
      <div className="card">
        <p>
          Choose the cash statement Excel file. It is unlocked and read <span className="strong">on this device</span>; only
          the transaction rows are saved. Uploading the whole file again is safe: only new or changed rows are updated.
        </p>
        <p className="muted small">The file itself is not uploaded or changed.</p>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {(step.kind === 'pick' || step.kind === 'working') && (
        <label className={`button primary block file-button ${step.kind === 'working' ? 'busy' : ''}`}>
          {step.kind === 'working' ? step.label : 'Choose file'}
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={step.kind === 'working'}
            onChange={(e) => {
              void onFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
      )}

      {step.kind === 'password' && (
        <form
          className="card form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (password) void read(step.file, password)
          }}
        >
          <p className="strong">{step.file.name} is password-protected</p>
          {step.wrong && (
            <p className="error" role="alert">
              Wrong password. Try again.
            </p>
          )}
          <label className="field">
            <span>Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" autoFocus />
          </label>
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>Remember on this device</span>
          </label>
          <button type="submit" className="button primary block" disabled={!password}>
            Unlock
          </button>
          <button type="button" className="button ghost block" onClick={() => setStep({ kind: 'pick' })}>
            Cancel
          </button>
        </form>
      )}

      {step.kind === 'preview' && (
        <div className="card">
          <p className="strong">{step.fileName}</p>
          <ul className="summary">
            <li>{plural(step.rows, 'transaction')} in the file</li>
            <li>{plural(step.plan.inserts.length, 'new row')}</li>
            <li>{plural(step.plan.changes.length, 'changed row')}</li>
            <li>{step.plan.unchanged} unchanged</li>
            {step.plan.missing.length > 0 && (
              <li className="warn-text">{plural(step.plan.missing.length, 'saved row')} no longer in the file (kept, and flagged)</li>
            )}
            {step.plan.packageProposals.length > 0 && <li>{plural(step.plan.packageProposals.length, 'new package')} to review on Today</li>}
          </ul>
          {step.plan.changes.length > 0 && (
            <details className="details">
              <summary>What changed</summary>
              <ul>
                {step.plan.changes.slice(0, 50).map((c) => (
                  <li key={c.id} className="small">
                    {formatDate(c.row.date, { short: true })} {c.row.voucher ?? ''} {c.row.nameRaw}: {c.fields.join(', ')}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {step.plan.unmatchedPackages.length > 0 && (
            <details className="details" open>
              <summary>{plural(step.plan.unmatchedPackages.length, 'package')} paid by someone the app doesn't know</summary>
              <ul>
                {step.plan.unmatchedPackages.map((r) => (
                  <li key={r.sourceKey} className="small">
                    “{r.nameRaw}”, {r.description}, {formatDate(r.date, { short: true })} ({formatMoney(r.debit ?? r.descAmount)})
                  </li>
                ))}
              </ul>
              <p className="muted small">
                Add them in Clients (or add this spelling as a name variant), then upload again to propose their package.
              </p>
            </details>
          )}
          {step.fixedDates.length > 0 && (
            <p className="muted small">Date typos corrected: {step.fixedDates.join('; ')}</p>
          )}
          <button type="button" className="button primary block" onClick={() => onImport(step.fileName, step.plan, step.fixedDates)}>
            Save
          </button>
          <button type="button" className="button ghost block" onClick={() => setStep({ kind: 'pick' })}>
            Cancel
          </button>
        </div>
      )}

      {step.kind === 'done' && (
        <div className="card">
          <p className="strong">Cash statement saved</p>
          <p>
            {plural(step.plan.inserts.length, 'new row')}, {plural(step.plan.changes.length, 'update')}
            {step.plan.packageProposals.length ? `, ${plural(step.plan.packageProposals.length, 'package')} to review` : ''}.
          </p>
          <Link className="button primary block" to="/">
            Back to Today
          </Link>
        </div>
      )}

      {readSaved() && step.kind === 'pick' && (
        <button
          type="button"
          className="button ghost"
          onClick={() => {
            writeSaved(null)
            setPassword('')
            setRemember(false)
          }}
        >
          Forget the saved password on this device
        </button>
      )}
    </section>
  )
}
