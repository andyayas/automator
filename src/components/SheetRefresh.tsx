import { useState } from 'react'
import { Link } from 'react-router'
import { parseContactsRows } from '../lib/contacts'
import { SETTING } from '../lib/defaults'
import { plural } from '../lib/format'
import { googleConfigured } from '../lib/google'
import { readLiveSheet } from '../lib/google-sheets'
import { useInvalidate, useSettings } from '../lib/queries'
import { parseScheduleGrids } from '../lib/schedule'
import { loadParseOptions, runScheduleImport } from '../lib/schedule-run'

/**
 * "Refresh from Google Sheet": reads this month's clinic sheet live (read-only)
 * and imports it like an upload. Shown when the month's sheet link is set.
 */
export function SheetRefresh({ date }: { date: string }) {
  const settings = useSettings()
  const invalidate = useInvalidate()
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'busy'; label: string } | { kind: 'done'; text: string } | { kind: 'error'; text: string }>({
    kind: 'idle',
  })

  const month = date.slice(0, 7)
  const sheetUrl = ((settings.data?.[SETTING.sheetLinks] ?? {}) as Record<string, string>)[month]
  const monthName = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long' })

  if (!googleConfigured || !settings.data) return null
  if (!sheetUrl) {
    return (
      <p className="muted small">
        To read the live sheet, <Link to="/more/settings">add the {monthName} sheet link in Settings</Link>.
      </p>
    )
  }

  async function refresh() {
    setState({ kind: 'busy', label: 'Opening the Google Sheet…' })
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
        (label) => setState({ kind: 'busy', label }),
      )
      await Promise.all([invalidate.schedule(), invalidate.clients()])
      const extra = [
        result.plan.unmatched ? `${result.plan.unmatched} to link` : '',
        result.phonesUpdated ? plural(result.phonesUpdated, 'phone') + ' updated' : '',
        result.plan.confirmedChanged.length ? `${plural(result.plan.confirmedChanged.length, 'confirmed day')} left as they were` : '',
      ].filter(Boolean)
      setState({ kind: 'done', text: `Updated ${plural(result.plan.replace.size, 'day')} from the sheet${extra.length ? ` · ${extra.join(' · ')}` : ''}` })
    } catch (err) {
      setState({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div className="sheet-refresh">
      <button type="button" className="button primary block" disabled={state.kind === 'busy'} onClick={refresh}>
        {state.kind === 'busy' ? state.label : 'Refresh from Google Sheet'}
      </button>
      {state.kind === 'done' && <p className="muted small">{state.text}</p>}
      {state.kind === 'error' && (
        <p className="error small" role="alert">
          {state.text}
        </p>
      )}
    </div>
  )
}
