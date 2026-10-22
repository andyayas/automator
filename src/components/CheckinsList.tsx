import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { CHECKIN_AFTER_DAYS, DEFAULT_CHECKIN_TEMPLATE, renderCheckin } from '../lib/checkins'
import { markCheckin, type CheckinRow } from '../lib/checkins-api'
import { SETTING } from '../lib/defaults'
import { formatDate, todayISO } from '../lib/format'
import { formatPhone } from '../lib/phone'
import { useCheckinsDue, useSettings } from '../lib/queries'
import { whatsappUrl } from '../lib/reminders'
import { Empty, ErrorCard, Loading } from './ui'

/** Reminders → Check-ins: clients who haven't been back for 30 days. */
export function CheckinsList() {
  const today = todayISO()
  const due = useCheckinsDue(today)
  const settings = useSettings()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const template = (settings.data?.[SETTING.checkinTemplate] as string | undefined) || DEFAULT_CHECKIN_TEMPLATE
  const senderName = (settings.data?.[SETTING.senderName] as string | undefined) ?? ''

  async function mark(c: CheckinRow, status: 'sent' | 'skipped') {
    try {
      await markCheckin(c.clientId, c.lastVisit, status, c.phone)
      await queryClient.invalidateQueries({ queryKey: ['checkins'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (due.isPending) return <Loading />
  if (due.isError) return <ErrorCard error={due.error} retry={() => void due.refetch()} />

  return (
    <>
      <p className="muted small">
        Clients whose last visit was {CHECKIN_AFTER_DAYS}+ days ago and who have nothing booked. Sending opens WhatsApp with a check-in
        message; once sent or skipped, they come back only after their next visit.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {!due.data.length ? (
        <Empty>No one to check in on today.</Empty>
      ) : (
        <div className="stack">
          {due.data.map((c) => {
            const message = renderCheckin(template, { name: c.name.split(' ')[0], lastVisit: c.lastVisit, senderName })
            return (
              <article key={c.clientId} className="card reminder">
                <div className="reminder-top">
                  <Link to={`/clients/${c.clientId}`} className="strong booking-name">
                    {c.name}
                  </Link>
                  <span className="badge warn">{c.daysSince} days</span>
                </div>
                <p className="muted small reminder-meta">
                  Last visit {formatDate(c.lastVisit, { short: true })}
                  {c.therapist ? ` · ${c.therapist}` : ''}
                  {c.phone ? (
                    <>
                      {' · '}
                      <span className="nowrap">{formatPhone(c.phone)}</span>
                    </>
                  ) : null}
                </p>
                {c.phone ? (
                  <a className="button whatsapp block" href={whatsappUrl(c.phone, message)} target="_blank" rel="noreferrer" onClick={() => void mark(c, 'sent')}>
                    Send on WhatsApp
                  </a>
                ) : (
                  <div className="booking-check">
                    <span className="small">No phone number for this client.</span>
                    <Link className="button small-button" to={`/clients/${c.clientId}/edit`}>
                      Add phone
                    </Link>
                  </div>
                )}
                <button type="button" className="button ghost small-button checkin-skip" onClick={() => void mark(c, 'skipped')}>
                  Skip
                </button>
              </article>
            )
          })}
        </div>
      )}
    </>
  )
}
