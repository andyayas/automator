import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { parseContactsRows } from '../lib/contacts'
import { SETTING } from '../lib/defaults'
import { plural } from '../lib/format'
import { connectGoogle, GoogleNotConnectedError, googleConfigured, loadGoogleScript } from '../lib/google'
import { readLiveSheet } from '../lib/google-sheets'
import { keys, useGoogleStatus, useInvalidate, useSettings } from '../lib/queries'
import { parseScheduleGrids } from '../lib/schedule'
import { loadParseOptions, runScheduleImport } from '../lib/schedule-run'

/** How often the sheet is read again while the app is open (and at most that often on reopening). */
export const AUTO_REFRESH_MS = 5 * 60_000

// Shared by every page, so moving between Schedule, Reminders and a review doesn't re-read each time.
const lastRead = new Map<string, number>()
const lastOk = new Map<string, number>()
let running = false

type State =
  | { kind: 'idle' }
  | { kind: 'busy'; label: string; auto: boolean }
  | { kind: 'done'; text: string }
  | { kind: 'error'; text: string }

/**
 * Reads this month's clinic sheet live (read-only) and imports it like an
 * upload. Once Google is connected (one tap, once, on any device) it does this
 * by itself: on opening the page, on coming back to the app, and every few
 * minutes.
 */
export function SheetRefresh({ date }: { date: string }) {
  const settings = useSettings()
  const invalidate = useInvalidate()
  const [state, setState] = useState<State>({ kind: 'idle' })
  const status = useGoogleStatus()
  const queryClient = useQueryClient()
  const connected = status.data?.connected ?? false

  const month = date.slice(0, 7)
  const sheetUrl = ((settings.data?.[SETTING.sheetLinks] ?? {}) as Record<string, string>)[month]
  const monthName = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long' })
  const refreshRef = useRef<(auto: boolean) => Promise<void>>(async () => {})
  // The timer below calls the latest refresh (it reads the current sheet link).
  useEffect(() => {
    refreshRef.current = refresh
  })

  useEffect(() => {
    if (!googleConfigured || !sheetUrl || !connected) return
    const tick = () => {
      if (document.visibilityState !== 'visible' || running) return
      if (Date.now() - (lastRead.get(sheetUrl) ?? 0) < AUTO_REFRESH_MS) return
      void refreshRef.current(true)
    }
    tick()
    const timer = window.setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('focus', tick)
    }
  }, [sheetUrl, connected])

  // Ready before the tap, so the Google window opens straight away (phones block late popups).
  useEffect(() => {
    if (googleConfigured && status.data && !connected) void loadGoogleScript().catch(() => undefined)
  }, [status.data, connected])

  if (!googleConfigured || !settings.data || !status.data) return null
  if (!sheetUrl) {
    return (
      <p className="muted small">
        To read the live sheet, <Link to="/more/settings">add the {monthName} sheet link in Settings</Link>.
      </p>
    )
  }

  async function refresh(auto: boolean) {
    if (running) return
    running = true
    lastRead.set(sheetUrl, Date.now())
    setState({ kind: 'busy', label: 'Reading the Google Sheet…', auto })
    try {
      const live = await readLiveSheet(sheetUrl)
      const days = parseScheduleGrids(live.grids, await loadParseOptions())
      if (!days.length) throw new Error('No day tabs found in that sheet. Check the link in Settings.')
      const result = await runScheduleImport(
        {
          days,
          contacts: live.contactsRows ? parseContactsRows(live.contactsRows).contacts : null,
          source: `Google Sheet: ${live.title}`,
          details: { gids: Object.fromEntries(live.tabs.map((t) => [t.title, t.gid])) },
        },
        (label) => setState({ kind: 'busy', label, auto }),
      )
      await Promise.all([invalidate.schedule(), invalidate.clients()])
      // Names to link show on the page itself; only say what it can't show.
      const changed = result.plan.confirmedChanged.length
      lastOk.set(sheetUrl, Date.now())
      setState({ kind: 'done', text: changed ? `${plural(changed, 'confirmed day')} left as they were` : '' })
    } catch (err) {
      if (err instanceof GoogleNotConnectedError) void queryClient.invalidateQueries({ queryKey: keys.googleStatus })
      setState({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      running = false
    }
  }

  async function connect() {
    setState({ kind: 'busy', label: 'Connecting to Google…', auto: false })
    try {
      await connectGoogle()
    } catch (err) {
      setState({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
      return
    }
    await queryClient.invalidateQueries({ queryKey: keys.googleStatus })
    await refresh(false)
  }

  const busy = state.kind === 'busy'
  const readAt = lastOk.get(sheetUrl)
  if (!connected && !busy) {
    return (
      <div className="sheet-refresh">
        <button type="button" className="button primary block" onClick={() => void connect()}>
          Connect Google Sheet
        </button>
        <p className="muted small">Once, with the Google account that opens the clinic sheet. After that the schedule stays up to date by itself on all your devices.</p>
        {state.kind === 'error' && (
          <p className="error small" role="alert">
            {state.text}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="sheet-refresh live">
      <span className={`live-dot${busy ? ' busy' : ''}`} aria-hidden="true" />
      <p className="muted small grow" role="status">
        {busy
          ? state.label
          : state.kind === 'error'
            ? ''
            : `Live from the Google Sheet${readAt ? ` · read at ${new Date(readAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}${state.kind === 'done' && state.text ? ` · ${state.text}` : ''}`}
        {state.kind === 'error' && (
          <span className="error" role="alert">
            {state.text}
          </span>
        )}
      </p>
      <button type="button" className="button ghost small-button" disabled={busy} onClick={() => void refresh(false)}>
        Refresh now
      </button>
    </div>
  )
}
