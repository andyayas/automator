import { useState } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '../components/ui'
import { applyContactsImport, fetchAllClients } from '../lib/api'
import { planContactsImport, type ContactsPlan } from '../lib/contacts-plan'
import { SETTING } from '../lib/defaults'
import { formatDate, plural } from '../lib/format'
import { createNameMatcher } from '../lib/names'
import { useInvalidate } from '../lib/queries'
import type { ScheduleDay } from '../lib/schedule'
import {
  applyScheduleImport,
  ensureDefaults,
  fetchAllAliases,
  fetchConfirmedDates,
  fetchPatterns,
  fetchSettings,
  fetchStoredBookings,
} from '../lib/schedule-api'
import { planScheduleImport, type ScheduleImportPlan } from '../lib/schedule-import'

type Step =
  | { kind: 'pick' }
  | { kind: 'working'; label: string }
  | { kind: 'preview'; fileName: string; days: ScheduleDay[]; contacts: ContactsPlan | null }
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
      const [{ read, utils }, { parseContacts }, { parseScheduleGrids }] = await Promise.all([
        import('xlsx'),
        import('../lib/contacts'),
        import('../lib/schedule'),
      ])
      await ensureDefaults()
      const [patterns, settings] = await Promise.all([fetchPatterns(), fetchSettings()])
      const workbook = read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      const grids = workbook.SheetNames.map((name) => ({
        name,
        rows: utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, blankrows: true, raw: true, defval: null }),
      }))
      const staffNames = (settings[SETTING.staffNames] as string[] | undefined) ?? []
      const days = parseScheduleGrids(grids, {
        patterns: patterns.map((p) => ({ pattern: p.pattern, match_type: p.match_type as 'exact' | 'contains' })),
        staffNames,
      })
      if (!days.length) throw new Error('No schedule days found. Is this the schedule export (one tab per day, date in I1)?')
      const hasContacts = workbook.SheetNames.some((n) => n.trim().toLowerCase() === 'contacts')
      const contacts = hasContacts ? planContactsImport(parseContacts(workbook).contacts, await fetchAllClients()) : null
      setStep({ kind: 'preview', fileName: file.name, days, contacts })
    } catch (err) {
      fail(err)
    }
  }

  async function onImport(fileName: string, days: ScheduleDay[], contacts: ContactsPlan | null) {
    setError(null)
    try {
      let contactsAdded = 0
      if (contacts && contacts.inserts.length + contacts.phoneUpdates.length) {
        setStep({ kind: 'working', label: 'Refreshing phones from Contacts…' })
        await applyContactsImport(contacts)
        contactsAdded = contacts.inserts.length
      }
      setStep({ kind: 'working', label: 'Matching names…' })
      const [clients, aliases] = await Promise.all([fetchAllClients(), fetchAllAliases()])
      const dates = days.map((d) => d.date)
      const [confirmed, stored] = await Promise.all([fetchConfirmedDates(dates), fetchStoredBookings(dates)])
      const plan = planScheduleImport(days, createNameMatcher(clients, aliases), confirmed, stored)
      setStep({ kind: 'working', label: 'Saving…' })
      await applyScheduleImport(plan, fileName)
      await Promise.all([invalidate.schedule(), invalidate.clients()])
      setStep({ kind: 'done', plan, contactsAdded, firstDate: dates[0] ?? null })
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
            {step.contacts && (
              <li>
                Contacts: {plural(step.contacts.inserts.length, 'new client')}, {plural(step.contacts.phoneUpdates.length, 'phone update')}
              </li>
            )}
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
