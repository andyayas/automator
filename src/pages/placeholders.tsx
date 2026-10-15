import { Placeholder } from './Placeholder'

export function TodayPage() {
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <Placeholder title={`Today · ${today}`} phase="phases 2 and 4">
      <ul>
        <li>Active packages and insurance approvals, with sessions left and low-session alerts.</li>
        <li>Items waiting for your review.</li>
        <li>The day's review: schedule and cash side by side, confirm, then download the report.</li>
      </ul>
    </Placeholder>
  )
}

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

export function ClientsPage() {
  return (
    <Placeholder title="Clients" phase="phase 2">
      <ul>
        <li>Search clients and see their history.</li>
        <li>Add or edit packages and insurance approvals.</li>
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
