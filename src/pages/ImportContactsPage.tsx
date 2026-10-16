import { useState } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '../components/ui'
import { applyContactsImport, fetchAllClients } from '../lib/api'
import { planContactsImport, type ContactsPlan } from '../lib/contacts-plan'
import { plural } from '../lib/format'
import { useInvalidate } from '../lib/queries'
import { fetchAllAliases } from '../lib/schedule-api'

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
      const isVcard = /\.vcf$/i.test(file.name) || /^BEGIN:VCARD/i.test((await file.slice(0, 20).text()).trim())
      let parsed: { contacts: import('../lib/contacts').ContactRow[]; duplicates: number }
      if (isVcard) {
        // A contacts export from the clinic phone.
        const { parseVcard } = await import('../lib/vcard')
        parsed = parseVcard(await file.text())
      } else {
        // Excel parsing is only loaded on this screen.
        const [{ read }, { parseContacts }] = await Promise.all([import('xlsx'), import('../lib/contacts-xlsx')])
        parsed = parseContacts(read(await file.arrayBuffer(), { type: 'array' }))
      }
      const [clients, aliases] = await Promise.all([fetchAllClients(), fetchAllAliases()])
      const plan = planContactsImport(parsed.contacts, clients, isVcard ? 'phone' : 'sheet', aliases)
      setStep({
        kind: 'preview',
        plan,
        fileName: file.name,
        duplicates: parsed.duplicates,
        noPhone: parsed.contacts.filter((c) => !c.phone).length,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Chrome: "Failed to fetch dynamically imported module"; Safari: "Importing a module script failed".
      setError(
        /dynamically imported module|module script failed/i.test(message)
          ? 'The app was just updated. Reload the page, then choose the file again.'
          : message,
      )
      setStep({ kind: 'pick' })
    }
  }

  async function onImport(plan: ContactsPlan) {
    setError(null)
    setStep({ kind: 'importing', done: 0, total: plan.inserts.length + plan.phoneUpdates.length })
    try {
      await applyContactsImport(plan, (done, total) => setStep({ kind: 'importing', done, total }))
      await invalidate.clients()
      setStep({ kind: 'done', added: plan.inserts.length, updated: plan.phoneUpdates.length + plan.phoneOverrides.length })
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
          Upload a contacts export from the clinic phone (<span className="strong">.vcf</span>), or an older schedule export
          that still has its <span className="strong">Contacts</span> tab (<span className="strong">.xlsx</span>). It is read on
          this device and new clients are added. For existing clients it only refreshes the phone from contacts. Names and
          phone fixes you made in the app are kept.
        </p>
        <p className="muted small">The file itself is not uploaded or changed.</p>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {(step.kind === 'pick' || step.kind === 'reading') && (
        <label className="button primary block file-button">
          {step.kind === 'reading' ? 'Reading…' : 'Choose file'}
          <input
            type="file"
            accept=".xlsx,.vcf,text/vcard,text/x-vcard,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
            {step.plan.phoneOverrides.length > 0 && (
              <li>{plural(step.plan.phoneOverrides.length, 'number')} updated to the one on the phone</li>
            )}
            {step.plan.aliases.length > 0 && (
              <li>{plural(step.plan.aliases.length, 'contact')} saved under another name for a client with the same number</li>
            )}
            <li>{step.plan.unchanged} unchanged</li>
            {step.noPhone > 0 && <li className="muted">{plural(step.noPhone, 'contact')} without a phone</li>}
            {step.duplicates > 0 && <li className="muted">{plural(step.duplicates, 'duplicate name')} merged</li>}
          </ul>
          {step.plan.skipped.length > 0 && (
            <details className="details">
              <summary>{plural(step.plan.skipped.length, 'contact')} not added: very close to an existing client</summary>
              <ul>
                {step.plan.skipped.map((x) => (
                  <li key={x.row.key} className="small">
                    “{x.row.name}” looks like “{x.closest}”
                  </li>
                ))}
              </ul>
              <p className="muted small">If one is really a different person, add them with Clients → Add.</p>
            </details>
          )}
          {step.plan.inserts.length + step.plan.phoneUpdates.length + step.plan.phoneOverrides.length + step.plan.aliases.length > 0 ? (
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
