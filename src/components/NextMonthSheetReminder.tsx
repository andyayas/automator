import { Link } from 'react-router'
import { SETTING } from '../lib/defaults'
import { todayISO } from '../lib/format'
import { googleConfigured } from '../lib/google'
import { monthTitle, nextMonth } from '../lib/month-sheet'
import { useSettings } from '../lib/queries'

/** Today, from the 25th: next month's schedule sheet isn't there yet. Opens More → New month sheet. */
export function NextMonthSheetReminder({ fromDay = 25 }: { fromDay?: number }) {
  const settings = useSettings()
  if (!googleConfigured || !settings.data) return null
  const today = todayISO()
  if (Number(today.slice(8)) < fromDay) return null
  const links = (settings.data[SETTING.sheetLinks] ?? {}) as Record<string, string>
  const month = nextMonth(today.slice(0, 7))
  if (links[month]) return null
  const name = monthTitle(month).split(' ')[0]
  return (
    <div className="card inline-action">
      <p className="small">
        <span className="strong">{name}’s sheet isn’t created yet.</span>
      </p>
      <Link className="button small-button primary" to={`/more/create-sheet?month=${month}`}>
        Create it
      </Link>
    </div>
  )
}
