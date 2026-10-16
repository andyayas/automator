// The small numbers on the menu tabs: only things she has to act on.
import { todayISO } from './format'
import { useApprovals, usePackages, useReminders, useScheduleDay } from './queries'
import { reminderQueue, sentReminder } from './reminder-queue'
import { useReviewDays, workingDay } from './review-days'

export function useNavCounts(): { today: number; reminders: number } {
  const today = todayISO()

  // Today: past days to review (not today itself, which can't be reviewed yet) and proposals to accept.
  const { days, earlier, loaded } = useReviewDays()
  const packages = usePackages()
  const approvals = useApprovals()
  const toReview = loaded ? days.filter((d) => d.date < today && !d.confirmed).length + earlier.length : 0
  const proposals =
    (packages.data ?? []).filter((p) => p.status === 'proposed').length + (approvals.data ?? []).filter((a) => a.status === 'proposed').length

  // Reminders: not sent yet for the next working day.
  const reminderDay = workingDay(today, 1)
  const entries = useScheduleDay(reminderDay)
  const reminders = useReminders(reminderDay)
  const unsent = entries.data && reminders.data ? reminderQueue(entries.data).filter((e) => !sentReminder(e, reminders.data)).length : 0

  return { today: toReview + proposals, reminders: unsent }
}
