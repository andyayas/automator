import { Link } from 'react-router'
import { CheckIcon, PendingIcon, RemindersIcon } from '../layout/icons'
import { formatDate } from '../lib/format'
import { useReviewDays, workingDay } from '../lib/review-days'
import { Badge } from './ui'

const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })

/** Today screen: the day's tasks (review yesterday and today, send tomorrow's reminders). */
export function DailyReviewCard() {
  const { today, days, earlier } = useReviewDays()
  const reminderDay = workingDay(today, 1)
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
              {confirmed ? <Badge tone="accent">Confirmed</Badge> : <Badge tone="warn">To review</Badge>}
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
      </div>
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
