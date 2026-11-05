import { Link } from 'react-router'
import { CheckIcon, ClientsIcon, PendingIcon, RemindersIcon } from '../layout/icons'
import { formatDate } from '../lib/format'
import { SETTING } from '../lib/defaults'
import { useCheckinsDue, useLateCash, useSettings } from '../lib/queries'
import { useReviewDays, workingDay } from '../lib/review-days'
import { Badge } from './ui'

const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })

/** Late lines are looked for over the last two months (the reach of balance updates too). */
function lateFrom(today: string, reviewsFrom: string): string {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 62)
  const from = d.toISOString().slice(0, 10)
  return reviewsFrom > from ? reviewsFrom : from
}

/** Today screen: the day's tasks (review yesterday and today, send tomorrow's reminders). */
export function DailyReviewCard() {
  const { today, days, earlier } = useReviewDays()
  const reminderDay = workingDay(today, 1)
  const checkins = useCheckinsDue(today)
  const checkinCount = checkins.data?.length ?? 0
  const settings = useSettings()
  const reviewsFrom = (settings.data?.[SETTING.reviewsFrom] as string | undefined) ?? ''
  const late = useLateCash(settings.data ? lateFrom(today, reviewsFrom) : null)
  return (
    <>
      <div className="card list">
        {days.map(({ date, confirmed }, i) => (
          <Link key={date} to={`/day/${date}`} className="list-row link task-row">
            <span className={`task-icon ${confirmed ? 'done' : 'todo'}`}>{confirmed ? <CheckIcon /> : <PendingIcon />}</span>
            <span className="row-text grow">
              <span className="strong">{i === 1 ? 'Today' : 'Last working day'}</span>
              <span className="muted small">{dayLabel(date)}</span>
            </span>
            <span className="badges">
              {confirmed ? <Badge tone="accent">Confirmed</Badge> : <Badge tone="accent">To review</Badge>}
              <span className="chevron">›</span>
            </span>
          </Link>
        ))}
        <Link to={`/reminders?date=${reminderDay}`} className="list-row link task-row">
          <span className="task-icon">
            <RemindersIcon />
          </span>
          <span className="row-text grow">
            <span className="strong">Reminders</span>
            <span className="muted small">For {dayLabel(reminderDay)}</span>
          </span>
          <span className="chevron">›</span>
        </Link>
        {checkinCount > 0 && (
          <Link to="/reminders?tab=checkins" className="list-row link task-row">
            <span className="task-icon">
              <ClientsIcon />
            </span>
            <span className="row-text grow">
              <span className="strong">Check-ins</span>
              <span className="muted small">
                {checkinCount === 1 ? '1 client hasn’t' : `${checkinCount} clients haven’t`} been back in 30 days
              </span>
            </span>
            <span className="chevron">›</span>
          </Link>
        )}
      </div>
      {(late.data?.length ?? 0) > 0 && (
        <div className="card notice earlier-days">
          <p className="small strong">New cash statement lines on confirmed days</p>
          <p className="muted small">Open the day and tap Edit this day to add them to the report.</p>
          <div className="chips">
            {late.data!.map(({ date }) => (
              <Link key={date} to={`/day/${date}`} className="chip">
                {formatDate(date, { short: true })}
              </Link>
            ))}
          </div>
        </div>
      )}
      {earlier.length > 0 && (
        <div className="card notice earlier-days">
          <p className="small strong">Earlier days not confirmed yet</p>
          <div className="chips">
            {earlier.map((d) => (
              <Link key={d} to={`/day/${d}`} className="chip">
                {formatDate(d, { short: true })}
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
