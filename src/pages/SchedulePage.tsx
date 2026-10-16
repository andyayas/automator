import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { DateNav, LinkClientDialog, StatusChip } from '../components/schedule-ui'
import { SheetRefresh } from '../components/SheetRefresh'
import { Badge, ErrorCard, Loading, PageHeader } from '../components/ui'
import { activeByClient, bookingContext, type ActiveByClient } from '../lib/booking-context'
import { SETTING } from '../lib/defaults'
import { formatTime, todayISO } from '../lib/format'
import { useApprovals, usePackages, useScheduleDay, useSettings } from '../lib/queries'
import { formatSlotTime } from '../lib/schedule'
import { tabUrl } from '../lib/google-sheets'
import { fetchScheduleImport, type ScheduleEntry } from '../lib/schedule-api'

export function SchedulePage() {
  const [params, setParams] = useSearchParams()
  const date = params.get('date') ?? todayISO()
  const entries = useScheduleDay(date)
  const packages = usePackages()
  const approvals = useApprovals()
  const settings = useSettings()
  const [linking, setLinking] = useState<ScheduleEntry | null>(null)

  const importId = entries.data?.find((e) => e.import_id)?.import_id ?? null
  const refreshed = useQuery({
    queryKey: ['import', importId],
    queryFn: () => fetchScheduleImport(importId!),
    enabled: Boolean(importId),
  })

  const active = useMemo(() => activeByClient(packages.data ?? [], approvals.data ?? []), [packages.data, approvals.data])
  const sheetLinks = (settings.data?.[SETTING.sheetLinks] ?? {}) as Record<string, string>
  const monthSheet = sheetLinks[date.slice(0, 7)]
  const tab = entries.data?.find((e) => e.sheet_tab)?.sheet_tab
  const sheetUrl = monthSheet ? tabUrl(monthSheet, tab ? refreshed.data?.gids[tab] : undefined) : null

  const list = entries.data ?? []
  const bookings = list.filter((e) => !e.is_non_client)
  const toLink = bookings.filter((e) => e.match_kind === 'none' || e.match_kind === 'fuzzy').length
  const therapists = [...new Set(list.map((e) => e.therapist))]
  const updatedAt = refreshed.data ? new Date(refreshed.data.importedAt) : null
  const meta = [
    // With a live sheet the line above shows the time; a file upload says so here.
    updatedAt && !refreshed.data?.source?.startsWith('Google Sheet')
      ? `Updated ${(updatedAt.toDateString() === new Date().toDateString() ? '' : `${updatedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, `) + formatTime(updatedAt)} from a file`
      : '',
    bookings.length ? `${bookings.length} booking${bookings.length === 1 ? '' : 's'}` : '',
    toLink ? `${toLink} to check` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className="page">
      <PageHeader
        title="Schedule"
        action={
          sheetUrl && (
            <a className="button small-button" href={sheetUrl} target="_blank" rel="noreferrer">
              Edit in Google Sheets
            </a>
          )
        }
      />
      <DateNav date={date} onChange={(d) => setParams({ date: d }, { replace: true })} />
      <SheetRefresh date={date} />

      {meta && (
        <div className="schedule-meta">
          <span className="muted small center">{meta}</span>
        </div>
      )}

      {entries.isPending && <Loading />}
      {entries.isError && <ErrorCard error={entries.error} retry={() => void entries.refetch()} />}
      {entries.data && !list.length && (
        <div className="card">
          <p className="strong">Nothing on the schedule for this day</p>
          <p className="muted">The app reads the clinic sheet by itself. If this day should have bookings, check it in Google Sheets, or pick another day.</p>
        </div>
      )}

      {list.length > 0 && (
        <>
          {/* Phone: one list in time order. */}
          <div className="schedule-list">
            {list.map((e) => (
              <BookingCard key={e.id} entry={e} date={date} active={active} onLink={setLinking} showTherapist />
            ))}
          </div>
          {/* Wide screens: a column per therapist. */}
          <div className="schedule-columns" style={{ gridTemplateColumns: `repeat(${therapists.length}, minmax(0, 1fr))` }}>
            {therapists.map((t) => (
              <div key={t} className="schedule-column">
                <h2 className="column-head">{t}</h2>
                {list
                  .filter((e) => e.therapist === t)
                  .map((e) => (
                    <BookingCard key={e.id} entry={e} date={date} active={active} onLink={setLinking} />
                  ))}
              </div>
            ))}
          </div>
        </>
      )}

      {linking && (
        <LinkClientDialog
          name={linking.parsed_name ?? linking.raw_text}
          suggestedId={linking.match_kind === 'fuzzy' ? linking.client_id : null}
          onClose={() => setLinking(null)}
        />
      )}
    </section>
  )
}

function BookingCard({
  entry: e,
  date,
  active,
  onLink,
  showTherapist,
}: {
  entry: ScheduleEntry
  date: string
  active: ActiveByClient
  onLink: (e: ScheduleEntry) => void
  showTherapist?: boolean
}) {
  const time = formatSlotTime(e.slot_time.slice(0, 5))
  if (e.is_non_client) {
    return (
      <div className="booking muted-booking">
        <span className="booking-time">{time}</span>
        <span className="muted">
          {e.raw_text}
          {showTherapist ? ` · ${e.therapist}` : ''}
        </span>
      </div>
    )
  }
  const context = e.match_kind === 'none' ? null : bookingContext(e.client_id, date, e.billing_note, active)
  const uncertain = e.match_kind === 'fuzzy'
  const unknown = e.match_kind === 'none' || !e.client_id

  return (
    <article className={`booking ${e.status === 'cancelled' ? 'cancelled' : ''}`}>
      <div className="booking-top">
        <span className="booking-time">{time}</span>
        <StatusChip status={e.status} />
      </div>
      <div className="booking-body">
        {e.client && !unknown ? (
          <Link to={`/clients/${e.client.id}`} className="strong booking-name">
            {e.client.name}
          </Link>
        ) : (
          <span className="strong booking-name">{e.parsed_name}</span>
        )}
        <span className="muted small">
          {showTherapist ? e.therapist : ''}
          {e.session_no ? `${showTherapist ? ' · ' : ''}session ${e.session_no} on the sheet` : ''}
          {e.inline_amount ? ` · $${e.inline_amount} noted` : ''}
        </span>
        {context && (
          <div className="booking-context">
            <span className="small">
              {context.label}
              {context.remaining !== null ? ` · ${context.remaining} left` : ''}
            </span>
            {context.alerts.map((a) => (
              <Badge key={a.text} tone={a.tone}>
                {a.text}
              </Badge>
            ))}
          </div>
        )}
        {uncertain && (
          <div className="booking-check">
            <span className="small">
              Sheet says “{e.parsed_name}”. Is this {e.client?.name}?
            </span>
            <button type="button" className="button small-button" onClick={() => onLink(e)}>
              Check
            </button>
          </div>
        )}
        {unknown && (
          <div className="booking-check">
            <span className="small">Not linked to a client</span>
            <button type="button" className="button small-button primary" onClick={() => onLink(e)}>
              Who is this?
            </button>
          </div>
        )}
      </div>
    </article>
  )
}
