import { useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { DateNav, LinkClientDialog, StatusChip } from '../components/schedule-ui'
import { SheetRefresh } from '../components/SheetRefresh'
import { Badge, Empty, ErrorCard, Loading, PageHeader } from '../components/ui'
import { updateClient } from '../lib/api'
import { SETTING } from '../lib/defaults'
import { formatPhone, normalizePhone } from '../lib/phone'
import { useInvalidate, useReminders, useScheduleDay, useSettings } from '../lib/queries'
import { DEFAULT_REMINDER_TEMPLATE, renderReminder, tomorrowISO, whatsappUrl } from '../lib/reminders'
import { formatSlotTime } from '../lib/schedule'
import { markReminderSent, markReminderUnsent, type Reminder, type ScheduleEntry } from '../lib/schedule-api'
import { formatTime } from '../lib/format'

export function RemindersPage() {
  const [params, setParams] = useSearchParams()
  const date = params.get('date') ?? tomorrowISO()
  const entries = useScheduleDay(date)
  const reminders = useReminders(date)
  const settings = useSettings()
  const invalidate = useInvalidate()
  const [linking, setLinking] = useState<ScheduleEntry | null>(null)
  const [error, setError] = useState<string | null>(null)

  const template = (settings.data?.[SETTING.reminderTemplate] as string | undefined) || DEFAULT_REMINDER_TEMPLATE
  const senderName = (settings.data?.[SETTING.senderName] as string | undefined) ?? ''

  // Clients only, not cancelled; a client booked twice that day gets one row per slot.
  const queue = useMemo(
    () => (entries.data ?? []).filter((e) => !e.is_non_client && e.status !== 'cancelled'),
    [entries.data],
  )
  const sentFor = (e: ScheduleEntry): Reminder | undefined =>
    reminders.data?.find((r) => r.client_id === e.client_id && r.slot_time.slice(0, 5) === e.slot_time.slice(0, 5) && r.sent_at)
  const sentCount = queue.filter((e) => sentFor(e)).length

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

  return (
    <section className="page">
      <PageHeader title="Reminders" />
      <DateNav date={date} onChange={(d) => setParams({ date: d }, { replace: true })} />
      <SheetRefresh date={date} />

      {settings.data && !senderName && (
        <div className="card notice">
          <p className="small">
            Reminders end with your name. <Link to="/more/settings">Set the sender name in Settings</Link> first.
          </p>
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
        <>
          <p className="muted small">
            {sentCount} of {queue.length} sent · Tapping Send opens WhatsApp with the message ready; you press Send there.
          </p>
          <div className="stack">
            {queue.map((e) => (
              <ReminderRow
                key={e.id}
                entry={e}
                sent={sentFor(e)}
                message={renderReminder(template, {
                  name: e.client?.name ?? e.parsed_name ?? '',
                  date,
                  slotTime: e.slot_time,
                  senderName,
                })}
                onSend={() => onSend(e)}
                onUnsend={async (r) => {
                  await markReminderUnsent(r.id)
                  await invalidate.schedule()
                }}
                onLink={() => setLinking(e)}
              />
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

function ReminderRow({
  entry: e,
  sent,
  message,
  onSend,
  onUnsend,
  onLink,
}: {
  entry: ScheduleEntry
  sent?: Reminder
  message: string
  onSend: () => void
  onUnsend: (r: Reminder) => Promise<void>
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
    <article className={`card reminder ${sent ? 'sent' : ''}`}>
      <div className="reminder-top">
        <div className="row-text">
          <span className="strong">{e.client && linked ? e.client.name : e.parsed_name}</span>
          <span className="muted small">
            {formatSlotTime(e.slot_time.slice(0, 5))} · {e.therapist}
            {phoneDigits && linked && (
              <>
                {' · '}
                <span className="nowrap">{formatPhone(phoneDigits)}</span>
              </>
            )}
          </span>
        </div>
        <div className="badges">
          {e.status === 'confirmed' ? (
            <Badge tone="accent">Already confirmed</Badge>
          ) : e.status === 'rescheduled' ? (
            <Badge tone="warn">Rescheduled</Badge>
          ) : (
            <StatusChip status={e.status} />
          )}
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
      ) : sent ? (
        <div className="reminder-actions">
          <span className="small sent-label">
            ✓ Sent {formatTime(sent.sent_at!)}
          </span>
          <a className="button small-button" href={whatsappUrl(phoneDigits, message)} target="_blank" rel="noreferrer">
            Open again
          </a>
          <button type="button" className="button ghost small-button" onClick={() => void onUnsend(sent)}>
            Mark not sent
          </button>
        </div>
      ) : (
        <a className="button primary block" href={whatsappUrl(phoneDigits, message)} target="_blank" rel="noreferrer" onClick={onSend}>
          Send on WhatsApp
        </a>
      )}
      {phoneError && <p className="error small">{phoneError}</p>}
    </article>
  )
}
