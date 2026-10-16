import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { Empty, ErrorCard, Loading, PageHeader, Section } from '../components/ui'
import { removeTemplate, uploadTemplate } from '../lib/day-api'
import { DEFAULT_PRICES, SETTING } from '../lib/defaults'
import { formatDate, parseNumber } from '../lib/format'
import { normalizeName } from '../lib/names'
import { connectGoogle, disconnectGoogle, googleConfigured, loadGoogleScript } from '../lib/google'
import { keys, useGoogleStatus, useInvalidate, usePatterns, useSettings, useTemplateInfo } from '../lib/queries'
import { DEFAULT_REMINDER_TEMPLATE, REMINDER_PLACEHOLDERS, renderReminder, tomorrowISO } from '../lib/reminders'
import { addPattern, deletePattern, ensureDefaults, saveSetting } from '../lib/schedule-api'
import { Field } from './clients/form-parts'

export function SettingsPage() {
  const settings = useSettings()
  const patterns = usePatterns()
  const queryClient = useQueryClient()
  // In the address, so it stays open after leaving and coming back.
  const [params, setParams] = useSearchParams()
  const advanced = params.get('advanced') === '1'

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
      {/* What she uses: the month's sheet link, Google, and the reminder message. */}
      <SheetLinks settings={settings.data} />
      {googleConfigured && <GoogleConnection />}
      <ReminderSettings settings={settings.data} />

      <button
        type="button"
        className="button ghost block advanced-toggle"
        aria-expanded={advanced}
        onClick={() => setParams(advanced ? {} : { advanced: '1' }, { replace: true })}
      >
        {advanced ? 'Hide advanced settings' : 'Advanced settings'}
        <span className={`chevron ${advanced ? 'open' : ''}`} aria-hidden="true">
          ›
        </span>
      </button>

      {/* Set once, or only changed when the clinic changes how it works. */}
      {advanced && (
        <>
          <PriceSettings settings={settings.data} />
          <ReviewsFromSetting settings={settings.data} />
          <TemplateSettings />
          <StaffNames settings={settings.data} />
          <Section title="Not clients">
            <p className="muted small">
              Schedule entries that are not client bookings (meetings, breaks…). “Exact” must be the whole cell; “contains”
              matches anywhere in it.
            </p>
            {patterns.isPending ? <Loading /> : <PatternList rows={patterns.data ?? []} />}
          </Section>
        </>
      )}
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
                <span className="grow">{new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
                <a className="button small-button" href={link} target="_blank" rel="noreferrer">
                  Open
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

/** Which Google account reads the sheet; connecting once covers every device. */
function GoogleConnection() {
  const status = useGoogleStatus()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const notConnected = status.data?.connected === false

  // Ready before the tap, so the Google window opens straight away (phones block late popups).
  useEffect(() => {
    if (notConnected) void loadGoogleScript().catch(() => undefined)
  }, [notConnected])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      await queryClient.invalidateQueries({ queryKey: keys.googleStatus })
      setBusy(false)
    }
  }

  return (
    <Section title="Google connection">
      {status.isPending ? (
        <Loading />
      ) : status.isError ? (
        <ErrorCard error={status.error} />
      ) : status.data.connected ? (
        <div className="card list">
          <div className="list-row">
            <span className="row-text">
              <span className="strong">Connected{status.data.email ? ` as ${status.data.email}` : ''}</span>
              <span className="muted small">
                The app reads the sheet by itself on all your devices
                {status.data.since ? ` · since ${formatDate(status.data.since.slice(0, 10), { short: true })}` : ''}
              </span>
            </span>
            <button
              type="button"
              className="button ghost danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Disconnect Google? The app stops reading the sheet until you connect again.')) void run(disconnectGoogle)
              }}
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <div className="card">
          <p className="muted small">
            Connect once, with the Google account that opens the clinic sheet. Read-only: the app never changes the sheet.
          </p>
          <button type="button" className="button primary block" disabled={busy} onClick={() => void run(connectGoogle)}>
            {busy ? 'Connecting…' : 'Connect Google'}
          </button>
        </div>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
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

function TemplateSettings() {
  const info = useTemplateInfo()
  const invalidate = useInvalidate()
  const [state, setState] = useState<string | null>(null)
  return (
    <Section title="Daily report template">
      <div className="card">
        <p className="small">
          {info.data
            ? `Using the template you uploaded on ${formatDate(info.data.updatedAt?.slice(0, 10))}.`
            : 'Using the clinic’s template built into the app.'}{' '}
          To change the layout or logo, upload a new .xlsx here.
        </p>
        {state && <p className={state.startsWith('Saved') ? 'muted small' : 'error'}>{state}</p>}
        <label className="button block file-button">
          {info.data ? 'Replace the template' : 'Upload a different template'}
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              setState('Uploading…')
              try {
                await uploadTemplate(file)
                await invalidate.template()
                setState('Saved.')
              } catch (err) {
                setState(err instanceof Error ? err.message : String(err))
              }
            }}
          />
        </label>
        {info.data && (
          <button
            type="button"
            className="button ghost block"
            onClick={async () => {
              await removeTemplate()
              await invalidate.template()
              setState('Saved. Using the built-in template again.')
            }}
          >
            Use the built-in template again
          </button>
        )}
      </div>
    </Section>
  )
}

function PriceSettings({ settings }: { settings: Record<string, unknown> }) {
  const [perSession, setPerSession] = useState(String(settings[SETTING.perSessionPrice] ?? DEFAULT_PRICES.perSessionPrice))
  const [insurance, setInsurance] = useState(String(settings[SETTING.insuranceBilled] ?? DEFAULT_PRICES.insuranceBilled))
  const { save, note, isError } = useSaver()
  return (
    <Section title="Default prices">
      <form
        className="card form"
        onSubmit={async (e) => {
          e.preventDefault()
          const a = parseNumber(perSession)
          const b = parseNumber(insurance)
          if (a === null || b === null) return
          await save(SETTING.perSessionPrice, a)
          await save(SETTING.insuranceBilled, b)
        }}
      >
        <div className="field-row">
          <Field label="Single session ($)" hint="Used when someone came but nothing was paid yet.">
            <input inputMode="decimal" value={perSession} onChange={(e) => setPerSession(e.target.value)} />
          </Field>
          <Field label="Insurance billed ($)" hint="Default for new approvals; each approval can differ.">
            <input inputMode="decimal" value={insurance} onChange={(e) => setInsurance(e.target.value)} />
          </Field>
        </div>
        {note && <p className={isError ? 'error' : 'muted small'}>{note}</p>}
        <button type="submit" className="button">
          Save prices
        </button>
      </form>
    </Section>
  )
}

function ReviewsFromSetting({ settings }: { settings: Record<string, unknown> }) {
  const [value, setValue] = useState((settings[SETTING.reviewsFrom] as string | undefined) ?? '')
  const { save, note, isError } = useSaver()
  return (
    <Section title="Daily reviews">
      <form
        className="card form"
        onSubmit={(e) => {
          e.preventDefault()
          void save(SETTING.reviewsFrom, value || null)
        }}
      >
        <Field label="Daily reviews start on" hint="Earlier days were reported by hand, so they aren't listed as “not confirmed”.">
          <input type="date" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        {note && <p className={isError ? 'error' : 'muted small'}>{note}</p>}
        <button type="submit" className="button">
          Save
        </button>
      </form>
    </Section>
  )
}
