import { useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { DateNav, LinkClientDialog } from '../components/schedule-ui'
import { SheetRefresh } from '../components/SheetRefresh'
import { Badge, Empty, ErrorCard, Loading, PageHeader, Section } from '../components/ui'
import { CheckIcon } from '../layout/icons'
import { updateClient } from '../lib/api'
import { SETTING } from '../lib/defaults'
import { formatPhone, normalizePhone } from '../lib/phone'
import { useInvalidate, useReminders, useScheduleDay, useSettings } from '../lib/queries'
import { DEFAULT_REMINDER_TEMPLATE, renderReminder, whatsappUrl } from '../lib/reminders'
import { formatSlotTime } from '../lib/schedule'
import { markReminderSent, markReminderUnsent, type Reminder, type ScheduleEntry } from '../lib/schedule-api'
import { formatTime, todayISO } from '../lib/format'
import { reminderQueue, sentReminder } from '../lib/reminder-queue'
import { workingDay } from '../lib/review-days'

export function RemindersPage() {
  const [params, setParams] = useSearchParams()
  // The next working day (Saturday evening -> Monday), like Today's shortcut and the menu count.
  const date = params.get('date') ?? workingDay(todayISO(), 1)
  const entries = useScheduleDay(date)
  const reminders = useReminders(date)
  const settings = useSettings()
  const invalidate = useInvalidate()
  const [linking, setLinking] = useState<ScheduleEntry | null>(null)
  const [error, setError] = useState<string | null>(null)

  const template = (settings.data?.[SETTING.reminderTemplate] as string | undefined) || DEFAULT_REMINDER_TEMPLATE
  const senderName = (settings.data?.[SETTING.senderName] as string | undefined) ?? ''

  const queue = useMemo(() => reminderQueue(entries.data ?? []), [entries.data])
  const sentFor = (e: ScheduleEntry): Reminder | undefined => sentReminder(e, reminders.data)

  async function onSend(e: ScheduleEntry) {
    if (!e.client_id || !e.client?.phone) return
    try {
      await markReminderSent({
        date,
        slot_time: e.slot_time,
        therapist: e.therapist,
        client_id: e.client_id,
        phone_used: e.client.phone,
      })
      await invalidate.schedule()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // Three groups: fix first (no phone or name not linked), then to send, then sent.
  const isLinked = (e: ScheduleEntry) => Boolean(e.client_id && e.match_kind !== 'none' && e.match_kind !== 'fuzzy')
  const needsFix = queue.filter((e) => !sentFor(e) && (!isLinked(e) || !e.client?.phone))
  const toSend = queue.filter((e) => !sentFor(e) && isLinked(e) && e.client?.phone)
  const sent = queue.filter((e) => sentFor(e))
  // Bookings that get no reminder, so nothing disappears silently.
  const skipped = (entries.data ?? []).filter((e) => !e.is_non_client && e.status === 'cancelled')
  const dayName = new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long' })
  const messageFor = (e: ScheduleEntry) =>
    renderReminder(template, { name: e.client?.name ?? e.parsed_name ?? '', date, slotTime: e.slot_time, senderName })
  const row = (e: ScheduleEntry) => (
    <ReminderRow
      key={e.id}
      entry={e}
      message={messageFor(e)}
      onSend={() => onSend(e)}
      onLink={() => setLinking(e)}
    />
  )

  return (
    <section className="page reminders">
      <PageHeader title="Reminders" />
      <DateNav date={date} onChange={(d) => setParams({ date: d }, { replace: true })} />
      <SheetRefresh date={date} />

      {settings.data && !senderName && (
        <div className="card notice inline-action">
          <p className="small">Reminders end with your name. Set it first.</p>
          <Link className="button small-button warn" to="/more/settings">
            Open Settings
          </Link>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      {(entries.isPending || reminders.isPending) && <Loading />}
      {entries.isError && <ErrorCard error={entries.error} retry={() => void entries.refetch()} />}

      {entries.data && !queue.length && (
        <Empty>
          No bookings to remind for this day.{' '}
          {!entries.data.length && 'If it should have some, check the day in Google Sheets.'}
        </Empty>
      )}

      {queue.length > 0 && (
        <div className="card reminder-progress">
          {sent.length === queue.length ? (
            <span className="task-icon done">
              <CheckIcon />
            </span>
          ) : null}
          <div className="grow">
            <p className="strong">
              {sent.length === queue.length ? `All sent for ${dayName}` : `${sent.length} of ${queue.length} sent`}
            </p>
            {sent.length < queue.length && (
              <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={queue.length} aria-valuenow={sent.length}>
                <span style={{ width: `${(sent.length / queue.length) * 100}%` }} />
              </div>
            )}
          </div>
        </div>
      )}

      {needsFix.length > 0 && (
        <Section title="Needs a fix" count={needsFix.length}>
          <div className="stack">{needsFix.map(row)}</div>
        </Section>
      )}
      {toSend.length > 0 && (
        <Section title="To send" count={toSend.length}>
          <div className="stack">{toSend.map(row)}</div>
        </Section>
      )}
      {sent.length > 0 && (
        <Section title="Sent" count={sent.length}>
          <div className="card list">
            {sent.map((e) => (
              <SentRow
                key={e.id}
                entry={e}
                sent={sentFor(e)!}
                message={messageFor(e)}
                onUnsend={async (r) => {
                  await markReminderUnsent(r.id)
                  await invalidate.schedule()
                }}
              />
            ))}
          </div>
        </Section>
      )}
      {skipped.length > 0 && (
        <p className="muted small center">
          Not reminded: {skipped.map((e) => `${e.client?.name ?? e.parsed_name} (cancelled)`).join(', ')}
        </p>
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

/** A reminder already sent: one compact line, with Open again / Undo. */
function SentRow({ entry: e, sent, message, onUnsend }: { entry: ScheduleEntry; sent: Reminder; message: string; onUnsend: (r: Reminder) => Promise<void> }) {
  const phone = e.client?.phone
  return (
    <div className="list-row sent-row">
      <span className="sent-tick" aria-hidden="true">
        <CheckIcon />
      </span>
      <span className="row-text grow">
        <span className="strong truncate">{e.client?.name ?? e.parsed_name}</span>
        <span className="muted small truncate">
          <span className="nowrap">{formatSlotTime(e.slot_time.slice(0, 5))}</span> · sent <span className="nowrap">{formatTime(sent.sent_at!)}</span>
        </span>
      </span>
      {phone && (
        <a className="button small-button" href={whatsappUrl(phone, message)} target="_blank" rel="noreferrer" aria-label="Open in WhatsApp again">
          Open
        </a>
      )}
      <button type="button" className="button small-button ghost" onClick={() => void onUnsend(sent)}>
        Undo
      </button>
    </div>
  )
}

function ReminderRow({
  entry: e,
  message,
  onSend,
  onLink,
}: {
  entry: ScheduleEntry
  message: string
  onSend: () => void
  onLink: () => void
}) {
  const invalidate = useInvalidate()
  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const linked = e.client_id && e.match_kind !== 'none' && e.match_kind !== 'fuzzy'
  const phoneDigits = e.client?.phone ?? null

  async function savePhone(ev: FormEvent) {
    ev.preventDefault()
    const digits = normalizePhone(phone)
    if (!digits) return setPhoneError('That number doesn’t look right.')
    try {
      await updateClient(e.client_id!, { phone_override: digits })
      setPhone('')
      setPhoneError(null)
      await Promise.all([invalidate.schedule(), invalidate.client(e.client_id!)])
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <article className="card reminder">
      <div className="reminder-grid">
        <span className="reminder-time">{formatSlotTime(e.slot_time.slice(0, 5))}</span>
        <div className="reminder-body">
          <div className="reminder-top">
            <span className="strong">{e.client && linked ? e.client.name : e.parsed_name}</span>
            <div className="badges">
              {e.status === 'confirmed' ? (
                <Badge tone="accent">Already confirmed</Badge>
              ) : e.status === 'rescheduled' ? (
                <Badge tone="warn">Rescheduled</Badge>
              ) : (
                <Badge>No reply yet</Badge>
              )}
            </div>
          </div>
          <p className="muted small reminder-meta">
            {e.therapist}
            {phoneDigits && linked && (
              <>
                {' · '}
                <span className="nowrap">{formatPhone(phoneDigits)}</span>
              </>
            )}
          </p>
        </div>
      </div>

      {!linked ? (
        <div className="booking-check">
          <span className="small">
            {e.match_kind === 'fuzzy' ? `Sheet says “${e.parsed_name}”. Is this ${e.client?.name}?` : 'Not linked to a client yet.'}
          </span>
          <button type="button" className="button small-button primary" onClick={onLink}>
            {e.match_kind === 'fuzzy' ? 'Check' : 'Who is this?'}
          </button>
        </div>
      ) : !phoneDigits ? (
        <form className="inline-form" onSubmit={savePhone}>
          <input
            type="tel"
            inputMode="tel"
            placeholder="No phone: add it here"
            value={phone}
            onChange={(ev) => setPhone(ev.target.value)}
            aria-label={`Phone for ${e.client?.name}`}
          />
          <button type="submit" className="button" disabled={!phone.trim()}>
            Save
          </button>
        </form>
      ) : (
        <>
          <a className="button whatsapp block" href={whatsappUrl(phoneDigits, message)} target="_blank" rel="noreferrer" onClick={onSend}>
            Send on WhatsApp
          </a>
          <details className="message-preview">
            <summary>See message</summary>
            <p className="small">{message}</p>
          </details>
        </>
      )}
      {phoneError && <p className="error small">{phoneError}</p>}
    </article>
  )
}
