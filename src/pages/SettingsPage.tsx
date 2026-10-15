import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { Empty, ErrorCard, Loading, PageHeader, Section } from '../components/ui'
import { SETTING } from '../lib/defaults'
import { normalizeName } from '../lib/names'
import { keys, useInvalidate, usePatterns, useSettings } from '../lib/queries'
import { DEFAULT_REMINDER_TEMPLATE, REMINDER_PLACEHOLDERS, renderReminder, tomorrowISO } from '../lib/reminders'
import { addPattern, deletePattern, ensureDefaults, saveSetting } from '../lib/schedule-api'
import { Field } from './clients/form-parts'

export function SettingsPage() {
  const settings = useSettings()
  const patterns = usePatterns()
  const queryClient = useQueryClient()

  useEffect(() => {
    // First visit: copy the default lists into her account.
    void ensureDefaults().then(() =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.settings }),
        queryClient.invalidateQueries({ queryKey: keys.patterns }),
      ]),
    )
  }, [queryClient])

  if (settings.isPending) return <section className="page"><PageHeader title="Settings" back="/more" /><Loading /></section>
  if (settings.isError) return <section className="page"><ErrorCard error={settings.error} /></section>

  return (
    <section className="page">
      <PageHeader title="Settings" back="/more" />
      <ReminderSettings settings={settings.data} />
      <SheetLinks settings={settings.data} />
      <StaffNames settings={settings.data} />
      <Section title="Not clients">
        <p className="muted small">
          Schedule entries that are not client bookings (meetings, breaks…). “Exact” must be the whole cell; “contains”
          matches anywhere in it.
        </p>
        {patterns.isPending ? <Loading /> : <PatternList rows={patterns.data ?? []} />}
      </Section>
    </section>
  )
}

function useSaver() {
  const invalidate = useInvalidate()
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | string>('idle')
  const save = async (key: string, value: Parameters<typeof saveSetting>[1]) => {
    setState('saving')
    try {
      await saveSetting(key, value)
      await invalidate.settings()
      setState('saved')
    } catch (err) {
      setState(err instanceof Error ? err.message : String(err))
    }
  }
  const note =
    state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'idle' ? null : state
  return { save, note, isError: !['idle', 'saving', 'saved'].includes(state) }
}

function ReminderSettings({ settings }: { settings: Record<string, unknown> }) {
  const [sender, setSender] = useState((settings[SETTING.senderName] as string) ?? '')
  const [template, setTemplate] = useState((settings[SETTING.reminderTemplate] as string) || DEFAULT_REMINDER_TEMPLATE)
  const { save, note, isError } = useSaver()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    await save(SETTING.senderName, sender.trim())
    await save(SETTING.reminderTemplate, template)
  }

  const preview = renderReminder(template, { name: 'Client Name', date: tomorrowISO(), slotTime: '17:30', senderName: sender || '{sender_name}' })

  return (
    <Section title="WhatsApp reminder">
      <form className="card form" onSubmit={onSubmit}>
        <Field label="Sender name" hint="How the message is signed, e.g. your name and the clinic name.">
          <input value={sender} onChange={(e) => setSender(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Message" hint={`You can use ${REMINDER_PLACEHOLDERS.join(' ')}`}>
          <textarea rows={12} value={template} onChange={(e) => setTemplate(e.target.value)} />
        </Field>
        <p className="muted small">Preview</p>
        <pre className="preview">{preview}</pre>
        {note && <p className={isError ? 'error' : 'muted small'}>{note}</p>}
        <div className="row-buttons">
          <button type="submit" className="button primary">
            Save
          </button>
          <button type="button" className="button ghost" onClick={() => setTemplate(DEFAULT_REMINDER_TEMPLATE)}>
            Reset message
          </button>
        </div>
      </form>
    </Section>
  )
}

function SheetLinks({ settings }: { settings: Record<string, unknown> }) {
  const links = (settings[SETTING.sheetLinks] as Record<string, string> | undefined) ?? {}
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [url, setUrl] = useState('')
  const { save, note, isError } = useSaver()

  async function onAdd(e: FormEvent) {
    e.preventDefault()
    if (!/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+/.test(url.trim())) return
    await save(SETTING.sheetLinks, { ...links, [month]: url.trim() })
    setUrl('')
  }

  return (
    <Section title="Clinic Google Sheet">
      <p className="muted small">
        Paste the link of each month’s schedule sheet. The Schedule screen then shows “Edit in Google Sheets” for that
        month. The app never changes the sheet.
      </p>
      {Object.keys(links).length > 0 && (
        <div className="card list">
          {Object.entries(links)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([m, link]) => (
              <div key={m} className="list-row">
                <a href={link} target="_blank" rel="noreferrer">
                  {new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                </a>
                <button
                  type="button"
                  className="button ghost danger"
                  onClick={() => {
                    const next = { ...links }
                    delete next[m]
                    void save(SETTING.sheetLinks, next)
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
        </div>
      )}
      <form className="card form" onSubmit={onAdd}>
        <div className="field-row">
          <Field label="Month">
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
          <Field label="Sheet link">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
          </Field>
        </div>
        {note && <p className={isError ? 'error' : 'muted small'}>{note}</p>}
        <button type="submit" className="button" disabled={!url.trim()}>
          Add link
        </button>
      </form>
    </Section>
  )
}

function StaffNames({ settings }: { settings: Record<string, unknown> }) {
  const [text, setText] = useState(((settings[SETTING.staffNames] as string[] | undefined) ?? []).join('\n'))
  const { save, note, isError } = useSaver()
  return (
    <Section title="Staff names">
      <form
        className="card form"
        onSubmit={(e) => {
          e.preventDefault()
          void save(
            SETTING.staffNames,
            text
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }}
      >
        <Field label="One per line" hint="Cells with only a staff member’s name are not treated as client bookings.">
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        {note && <p className={isError ? 'error' : 'muted small'}>{note}</p>}
        <button type="submit" className="button">
          Save staff names
        </button>
      </form>
    </Section>
  )
}

function PatternList({ rows }: { rows: Array<{ id: string; pattern: string; match_type: string }> }) {
  const invalidate = useInvalidate()
  const [pattern, setPattern] = useState('')
  const [type, setType] = useState<'exact' | 'contains'>('exact')
  const [error, setError] = useState<string | null>(null)

  async function onAdd(e: FormEvent) {
    e.preventDefault()
    const value = pattern.toLowerCase().replace(/\s+/g, ' ').trim()
    if (!normalizeName(value) && value !== '-') return
    try {
      setError(null)
      await addPattern({ pattern: value, match_type: type })
      setPattern('')
      await invalidate.settings()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      {rows.length ? (
        <div className="card list">
          {rows.map((r) => (
            <div key={r.id} className="list-row">
              <span>
                {r.pattern} <span className="muted small">({r.match_type})</span>
              </span>
              <button
                type="button"
                className="button ghost danger"
                onClick={async () => {
                  await deletePattern(r.id)
                  await invalidate.settings()
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : (
        <Empty>None yet.</Empty>
      )}
      <form className="inline-form" onSubmit={onAdd}>
        <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="e.g. team lunch" aria-label="New entry" />
        <select value={type} onChange={(e) => setType(e.target.value as 'exact' | 'contains')} aria-label="Match type">
          <option value="exact">exact</option>
          <option value="contains">contains</option>
        </select>
        <button type="submit" className="button" disabled={!pattern.trim()}>
          Add
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </>
  )
}
