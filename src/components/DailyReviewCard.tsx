import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { fetchMonth, fetchRecentReviews } from '../lib/day-api'
import { SETTING } from '../lib/defaults'
import { formatDate, todayISO } from '../lib/format'
import { useSettings } from '../lib/queries'
import { Badge } from './ui'

/** The last working day before today (the clinic is closed on Sundays). */
function previousWorkingDay(today: string): string {
  const d = new Date(`${today}T00:00:00`)
  do d.setDate(d.getDate() - 1)
  while (d.getDay() === 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Today screen: open yesterday's or today's review, with their status. */
export function DailyReviewCard() {
  const today = todayISO()
  const dates = [previousWorkingDay(today), today]
  const reviews = useQuery({ queryKey: ['day-review', 'recent', ...dates], queryFn: () => fetchRecentReviews(dates) })
  // Earlier days this month with bookings that are not confirmed yet.
  const settings = useSettings()
  const reviewsFrom = (settings.data?.[SETTING.reviewsFrom] as string | undefined) ?? null
  const month = useQuery({
    queryKey: ['day-review', 'month', today.slice(0, 7), reviewsFrom],
    queryFn: () => fetchMonth(today.slice(0, 7), today, reviewsFrom),
    enabled: Boolean(settings.data),
  })
  const earlier = (month.data?.notConfirmed ?? []).filter((d) => !dates.includes(d))
  return (
    <>
    <div className="card list">
      {dates.map((date, i) => {
        const r = reviews.data?.find((x) => x.date === date)
        const label = new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
        return (
          <Link key={date} to={`/day/${date}`} className="list-row link">
            <span className="row-text">
              <span className="strong">{i === 1 ? 'Today' : 'Last working day'}</span>
              <span className="muted small">{label}</span>
            </span>
            <span className="badges">
              {r?.confirmed_at ? <Badge tone="accent">Confirmed</Badge> : <Badge tone="warn">To review</Badge>}
              <span className="chevron">›</span>
            </span>
          </Link>
        )
      })}
    </div>
    {earlier.length > 0 && (
      <p className="muted small">
        Earlier days not confirmed yet:{' '}
        {earlier.map((d, i) => (
          <span key={d}>
            {i ? ', ' : ''}
            <Link to={`/day/${d}`}>{formatDate(d, { short: true })}</Link>
          </span>
        ))}
      </p>
    )}
    </>
  )
}
