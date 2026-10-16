import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { SETTING } from '../lib/defaults'
import { todayISO } from '../lib/format'
import { connectGoogle, googleConfigured } from '../lib/google'
import { createMonthSheet } from '../lib/google-sheets'
import { missingSheetMonth, monthTitle } from '../lib/month-sheet'
import { keys, useGoogleStatus, useSettings } from '../lib/queries'
import { fetchRecentTherapists, saveSetting } from '../lib/schedule-api'

/**
 * "Create November sheet": makes the month's schedule sheet in the connected
 * Google account, shares it with the list in Settings, and saves its link.
 * `onlyFromDay`: on Today it only shows near the end of the month.
 */
export function MonthSheetCreator({ onlyFromDay }: { onlyFromDay?: number }) {
  const settings = useSettings()
  const status = useGoogleStatus()
  const queryClient = useQueryClient()
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'busy'; label: string } | { kind: 'done'; url: string; text: string } | { kind: 'error'; text: string }>({
    kind: 'idle',
  })

  if (!googleConfigured || !settings.data || !status.data) return null
  const links = (settings.data[SETTING.sheetLinks] ?? {}) as Record<string, string>
  const shareWith = ((settings.data[SETTING.shareWith] as string[] | undefined) ?? []).filter(Boolean)
  const today = todayISO()
  const month = missingSheetMonth(links, today)

  if (state.kind === 'done') {
    return (
      <div className="card inline-action">
        <p className="small">{state.text}</p>
        <a className="button small-button" href={state.url} target="_blank" rel="noreferrer">
          Open
        </a>
      </div>
    )
  }
  if (!month) return null
  // Today only nags near the end of the month, for next month's sheet.
  if (onlyFromDay && (month === today.slice(0, 7) || Number(today.slice(8)) < onlyFromDay)) return null
  const name = monthTitle(month).split(' ')[0]

  async function create() {
    if (!month) return
    try {
      if (!status.data?.canCreate) {
        setState({ kind: 'busy', label: 'Asking Google…' })
        await connectGoogle()
        await queryClient.invalidateQueries({ queryKey: keys.googleStatus })
      }
      setState({ kind: 'busy', label: `Creating the ${name} sheet…` })
      const therapists = await fetchRecentTherapists(today)
      const result = await createMonthSheet(month, therapists, shareWith)
      await saveSetting(SETTING.sheetLinks, { ...links, [month]: result.url })
      await queryClient.invalidateQueries({ queryKey: keys.settings })
      setState({
        kind: 'done',
        url: result.url,
        text: `${result.title} is ready${result.shared.length ? `, shared with ${result.shared.length === 1 ? result.shared[0] : `${result.shared.length} people`}` : ' (not shared with anyone yet)'}. Its link is saved.`,
      })
    } catch (err) {
      setState({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  const busy = state.kind === 'busy'
  return (
    <div className="card stack month-sheet">
      <div className="inline-action">
        <p className="small">
          <span className="strong">{name}’s sheet isn’t created yet.</span>{' '}
          {status.data.connected ? 'The app can make it in the clinic’s design and save its link.' : 'Connect Google first (below).'}
        </p>
        <button type="button" className="button small-button primary" disabled={busy || !status.data.connected} onClick={() => void create()}>
          {busy ? state.label : `Create ${name} sheet`}
        </button>
      </div>
      {state.kind === 'error' && (
        <p className="error small" role="alert">
          {state.text}
        </p>
      )}
    </div>
  )
}
