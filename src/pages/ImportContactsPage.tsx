import { useState } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '../components/ui'
import { applyContactsImport, fetchAllClients } from '../lib/api'
import { planContactsImport, type ContactsPlan } from '../lib/contacts-plan'
import { plural } from '../lib/format'
import { useInvalidate } from '../lib/queries'

type Step =
  | { kind: 'pick' }
  | { kind: 'reading' }
  | { kind: 'preview'; plan: ContactsPlan; fileName: string; duplicates: number; noPhone: number }
  | { kind: 'importing'; done: number; total: number }
  | { kind: 'done'; added: number; updated: number }

/** More → Import clients: reads the Contacts tab of a schedule export in the browser. */
export function ImportContactsPage() {
  const invalidate = useInvalidate()
  const [step, setStep] = useState<Step>({ kind: 'pick' })
  const [error, setError] = useState<string | null>(null)

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    setStep({ kind: 'reading' })
    try {
      // Excel parsing is only loaded on this screen.
      const [{ read }, { parseContacts }] = await Promise.all([import('xlsx'), import('../lib/contacts')])
      const workbook = read(await file.arrayBuffer(), { type: 'array' })
      const parsed = parseContacts(workbook)
      const plan = planContactsImport(parsed.contacts, await fetchAllClients())
      setStep({
        kind: 'preview',
        plan,
        fileName: file.name,
        duplicates: parsed.duplicates,
        noPhone: parsed.contacts.filter((c) => !c.phone).length,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep({ kind: 'pick' })
    }
  }

  async function onImport(plan: ContactsPlan) {
    setError(null)
    setStep({ kind: 'importing', done: 0, total: plan.inserts.length + plan.phoneUpdates.length })
    try {
      await applyContactsImport(plan, (done, total) => setStep({ kind: 'importing', done, total }))
      await invalidate.clients()
      setStep({ kind: 'done', added: plan.inserts.length, updated: plan.phoneUpdates.length })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep({ kind: 'pick' })
    }
  }

  return (
    <section className="page">
      <PageHeader title="Import clients" back="/more" />

      <div className="card">
        <p>
          Upload the schedule export (<span className="strong">.xlsx</span>). The app reads its{' '}
          <span className="strong">Contacts</span> tab on this device and adds new clients. For existing clients it only
          refreshes the Contacts phone. Names and phone fixes you made in the app are kept.
        </p>
        <p className="muted small">The file itself is not uploaded or changed.</p>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {(step.kind === 'pick' || step.kind === 'reading') && (
        <label className="button primary block file-button">
          {step.kind === 'reading' ? 'Reading…' : 'Choose file'}
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={step.kind === 'reading'}
            onChange={(e) => {
              void onFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
      )}

      {step.kind === 'preview' && (
        <div className="card">
          <p className="strong">{step.fileName}</p>
          <ul className="summary">
            <li>{plural(step.plan.inserts.length, 'new client')}</li>
            <li>{plural(step.plan.phoneUpdates.length, 'phone update')}</li>
            <li>{step.plan.unchanged} unchanged</li>
            {step.noPhone > 0 && <li className="muted">{plural(step.noPhone, 'contact')} without a phone</li>}
            {step.duplicates > 0 && <li className="muted">{plural(step.duplicates, 'duplicate name')} merged</li>}
          </ul>
          {step.plan.inserts.length + step.plan.phoneUpdates.length > 0 ? (
            <button type="button" className="button primary block" onClick={() => onImport(step.plan)}>
              Import
            </button>
          ) : (
            <p className="muted">Everything is already up to date.</p>
          )}
          <button type="button" className="button ghost block" onClick={() => setStep({ kind: 'pick' })}>
            Choose a different file
          </button>
        </div>
      )}

      {step.kind === 'importing' && (
        <div className="card" aria-busy="true">
          <p>
            Importing… {step.done} of {step.total}
          </p>
          <progress max={step.total} value={step.done} />
        </div>
      )}

      {step.kind === 'done' && (
        <div className="card">
          <p className="strong">Done</p>
          <p>
            {plural(step.added, 'client')} added, {plural(step.updated, 'phone')} updated.
          </p>
          <Link className="button primary block" to="/clients">
            Go to clients
          </Link>
        </div>
      )}
    </section>
  )
}
