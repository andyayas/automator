import { useState } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '../components/ui'
import type { ContactRow } from '../lib/contacts'
import { formatDate, plural } from '../lib/format'
import { useInvalidate } from '../lib/queries'
import type { ScheduleDay } from '../lib/schedule'
import type { ScheduleImportPlan } from '../lib/schedule-import'
import { loadParseOptions, runScheduleImport } from '../lib/schedule-run'

type Step =
  | { kind: 'pick' }
  | { kind: 'working'; label: string }
  | { kind: 'preview'; fileName: string; days: ScheduleDay[]; contacts: ContactRow[] | null }
  | { kind: 'done'; plan: ScheduleImportPlan; contactsAdded: number; firstDate: string | null }

const RELOAD_HINT = /dynamically imported module|module script failed/i

/** Schedule → Update: reads the exported schedule (.xlsx) on this device. */
export function ScheduleImportPage() {
  const invalidate = useInvalidate()
  const [step, setStep] = useState<Step>({ kind: 'pick' })
  const [error, setError] = useState<string | null>(null)

  const fail = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    setError(RELOAD_HINT.test(message) ? 'The app was just updated. Reload the page, then choose the file again.' : message)
    setStep({ kind: 'pick' })
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    setStep({ kind: 'working', label: 'Reading the file…' })
    try {
      const [{ read }, { sheetRows }, { parseContacts }, { parseScheduleGrids }] = await Promise.all([
        import('xlsx'),
        import('../lib/sheet-rows'),
        import('../lib/contacts-xlsx'),
        import('../lib/schedule'),
      ])
      const options = await loadParseOptions()
      const workbook = read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      const days = parseScheduleGrids(
        workbook.SheetNames.map((name) => ({ name, rows: sheetRows(workbook.Sheets[name]) })),
        options,
      )
      if (!days.length) throw new Error('No schedule days found. Is this the schedule export (one tab per day, date in I1)?')
      const hasContacts = workbook.SheetNames.some((n) => n.trim().toLowerCase() === 'contacts')
      const contacts = hasContacts ? parseContacts(workbook).contacts : null
      setStep({ kind: 'preview', fileName: file.name, days, contacts })
    } catch (err) {
      fail(err)
    }
  }

  async function onImport(fileName: string, days: ScheduleDay[], contacts: ContactRow[] | null) {
    setError(null)
    try {
      const result = await runScheduleImport({ days, contacts, source: fileName }, (label) => setStep({ kind: 'working', label }))
      await Promise.all([invalidate.schedule(), invalidate.clients()])
      setStep({ kind: 'done', plan: result.plan, contactsAdded: result.contactsAdded, firstDate: days[0]?.date ?? null })
    } catch (err) {
      fail(err)
    }
  }

  return (
    <section className="page">
      <PageHeader title="Update schedule" back="/schedule" />

      <div className="card">
        <p>
          Upload the schedule export (<span className="strong">.xlsx</span>, one tab per day). The app reads it on this
          device, refreshes phones from its <span className="strong">Contacts</span> tab, and replaces each day it
          contains. Days you have already confirmed are never changed.
        </p>
        <p className="muted small">The file and the Google Sheet are not changed.</p>
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

      {step.kind === 'preview' && (
        <div className="card">
          <p className="strong">{step.fileName}</p>
          <ul className="summary">
            <li>
              {plural(step.days.length, 'day')}: {formatDate(step.days[0].date, { short: true })} to{' '}
              {formatDate(step.days.at(-1)!.date, { short: true })}
            </li>
            <li>{plural(step.days.reduce((n, d) => n + d.rows.filter((r) => !r.isNonClient).length, 0), 'booking')}</li>
            {step.contacts && <li>Contacts tab: {plural(step.contacts.length, 'contact')} (phones are refreshed)</li>}
          </ul>
          <button type="button" className="button primary block" onClick={() => onImport(step.fileName, step.days, step.contacts)}>
            Import
          </button>
          <button type="button" className="button ghost block" onClick={() => setStep({ kind: 'pick' })}>
            Choose a different file
          </button>
        </div>
      )}

      {step.kind === 'done' && (
        <div className="card">
          <p className="strong">Schedule updated</p>
          <ul className="summary">
            <li>{plural(step.plan.replace.size, 'day')} loaded, {plural(step.plan.bookings, 'booking')}</li>
            <li>{step.plan.matched} matched to a client</li>
            {step.plan.uncertain > 0 && <li>{step.plan.uncertain} probable matches to check</li>}
            {step.plan.unmatched > 0 && (
              <li>
                {step.plan.unmatched} bookings ({plural(step.plan.unmatchedNames.length, 'name')}) not linked to a client yet
              </li>
            )}
            {step.contactsAdded > 0 && <li>{plural(step.contactsAdded, 'new client')} from Contacts</li>}
            {step.plan.confirmedChanged.map((c) => (
              <li key={c.date} className="muted">
                {formatDate(c.date)} is confirmed, so it was left as it was ({plural(c.differences, 'difference')} in the file)
              </li>
            ))}
          </ul>
          {step.plan.unmatchedNames.length > 0 && (
            <p className="muted small">
              Link unknown names from the Schedule screen (“Who is this?”). Each spelling only needs it once.
            </p>
          )}
          <Link className="button primary block" to={step.firstDate ? `/schedule?date=${step.firstDate}` : '/schedule'}>
            Open the schedule
          </Link>
        </div>
      )}
    </section>
  )
}
