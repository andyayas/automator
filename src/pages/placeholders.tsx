import { Placeholder } from './Placeholder'

export function SchedulePage() {
  return (
    <Placeholder title="Schedule" phase="phase 3">
      <ul>
        <li>The day's bookings from the clinic's Google Sheet, read-only.</li>
        <li>Each booking's status, package or approval, and sessions left.</li>
        <li>A button to edit the day in Google Sheets.</li>
      </ul>
    </Placeholder>
  )
}

export function RemindersPage() {
  return (
    <Placeholder title="Reminders" phase="phase 3">
      <ul>
        <li>Tomorrow's WhatsApp reminders, one tap each.</li>
        <li>Sent and unsent at a glance, with missing phones flagged.</li>
      </ul>
    </Placeholder>
  )
}
