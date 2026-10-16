import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ErrorCard, Loading, PageHeader, Section } from '../components/ui'
import { SETTING } from '../lib/defaults'
import { todayISO } from '../lib/format'
import { connectGoogle, googleConfigured } from '../lib/google'
import { createMonthSheet } from '../lib/google-sheets'
import { missingSheetMonth, monthTitle, nextMonth } from '../lib/month-sheet'
import { keys, useGoogleStatus, useInvalidate, useSettings } from '../lib/queries'
import { fetchRecentTherapists, saveSetting } from '../lib/schedule-api'
import { Field } from './clients/form-parts'

type State = { kind: 'idle' } | { kind: 'busy'; label: string } | { kind: 'done'; url: string; text: string } | { kind: 'error'; text: string }

/**
 * More → New month sheet: creates a month's schedule sheet in the connected
 * Google account, in the clinic's design, shares it with the list below, and
 * saves its link for that month.
 */
export function CreateSheetPage() {
  const settings = useSettings()
  const status = useGoogleStatus()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const today = todayISO()
  const links = (settings.data?.[SETTING.sheetLinks] ?? {}) as Record<string, string>
  const [month, setMonth] = useState(() => params.get('month') ?? missingSheetMonth(links, today) ?? nextMonth(today.slice(0, 7)))
  const [state, setState] = useState<State>({ kind: 'idle' })

  if (settings.isPending || status.isPending) return <Frame><Loading /></Frame>
  if (settings.isError) return <Frame><ErrorCard error={settings.error} /></Frame>

  const shareWith = ((settings.data[SETTING.shareWith] as string[] | undefined) ?? []).filter(Boolean)
  const existing = links[month]
  const title = monthTitle(month)
  const connected = status.data?.connected ?? false
  const busy = state.kind === 'busy'

  async function create() {
    try {
      if (!status.data?.canCreate) {
        setState({ kind: 'busy', label: 'Asking Google…' })
        await connectGoogle()
        await queryClient.invalidateQueries({ queryKey: keys.googleStatus })
      }
      setState({ kind: 'busy', label: `Creating ${title}…` })
      const therapists = await fetchRecentTherapists(today)
      const result = await createMonthSheet(month, therapists, shareWith)
      await saveSetting(SETTING.sheetLinks, { ...links, [month]: result.url })
      await queryClient.invalidateQueries({ queryKey: keys.settings })
      setState({
        kind: 'done',
        url: result.url,
        text: `${result.title} is ready${result.shared.length ? `, shared with ${result.shared.length === 1 ? result.shared[0] : `${result.shared.length} people`}` : ''}. Its link is saved, so the app reads it from now on.`,
      })
    } catch (err) {
      setState({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <Frame>
      <p className="muted">A new Google Sheet in the clinic’s design: one tab per working day, ready for the physios to book in.</p>

      <div className="card form">
        <Field label="Month">
          <input
            type="month"
            value={month}
            onChange={(e) => {
              if (e.target.value) setMonth(e.target.value)
              setState({ kind: 'idle' })
            }}
          />
        </Field>

        {state.kind === 'done' ? (
          <div className="inline-action">
            <p className="small">{state.text}</p>
            <a className="button small-button" href={state.url} target="_blank" rel="noreferrer">
              Open
            </a>
          </div>
        ) : existing ? (
          <div className="inline-action">
            <p className="small muted">{title} already has a sheet.</p>
            <a className="button small-button" href={existing} target="_blank" rel="noreferrer">
              Open
            </a>
          </div>
        ) : !googleConfigured || !connected ? (
          <div className="inline-action">
            <p className="small muted">Connect Google first, with the clinic account.</p>
            <Link className="button small-button" to="/more/settings">
              Settings
            </Link>
          </div>
        ) : (
          <button type="button" className="button primary block" disabled={busy} onClick={() => void create()}>
            {busy ? state.label : `Create ${title} sheet`}
          </button>
        )}
        {state.kind === 'error' && (
          <p className="error small" role="alert">
            {state.text}
          </p>
        )}
        {!existing && state.kind !== 'done' && (
          <p className="muted small">
            {shareWith.length ? `It will be shared with ${shareWith.length === 1 ? shareWith[0] : `${shareWith.length} people`} (below).` : 'Not shared with anyone (add emails below).'}
          </p>
        )}
      </div>

      <ShareWith settings={settings.data} />
    </Frame>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="page">
      <PageHeader title="New month sheet" back="/more" />
      {children}
    </section>
  )
}

/** Who gets edit access to each new month's sheet. */
function ShareWith({ settings }: { settings: Record<string, unknown> }) {
  const saved = ((settings[SETTING.shareWith] as string[] | undefined) ?? []).join('\n')
  const [text, setText] = useState(saved)
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null)
  const invalidate = useInvalidate()

  async function onSave(e: FormEvent) {
    e.preventDefault()
    const emails = text.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)
    const bad = emails.filter((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))
    if (bad.length) return setNote({ text: `Check ${bad.join(', ')}: that doesn’t look like an email.`, error: true })
    try {
      await saveSetting(SETTING.shareWith, [...new Set(emails)])
      await invalidate.settings()
      setNote({ text: 'Saved', error: false })
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : String(err), error: true })
    }
  }

  return (
    <Section title="Share new sheets with">
      <form className="card form" onSubmit={onSave}>
        <label className="field">
          <span>Emails, one per line</span>
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="physio@gmail.com" autoCapitalize="off" spellCheck={false} />
          <span className="hint">They get edit access, and an email from Google, when a month’s sheet is created.</span>
        </label>
        {note && <p className={note.error ? 'error small' : 'muted small'}>{note.text}</p>}
        <button type="submit" className="button">
          Save
        </button>
      </form>
    </Section>
  )
}
