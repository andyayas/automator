import { useQuery } from '@tanstack/react-query'
import { fetchMonth, fetchRecentReviews } from './day-api'
import { SETTING } from './defaults'
import { todayISO } from './format'
import { useSettings } from './queries'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The working day before or after `day` (the clinic is closed on Sundays). */
export function workingDay(day: string, step: 1 | -1): string {
  const d = new Date(`${day}T00:00:00`)
  do d.setDate(d.getDate() + step)
  while (d.getDay() === 0)
  return iso(d)
}

/** Yesterday's and today's reviews, plus earlier days this month not confirmed yet. */
export function useReviewDays() {
  const today = todayISO()
  const dates = [workingDay(today, -1), today]
  const reviews = useQuery({ queryKey: ['day-review', 'recent', ...dates], queryFn: () => fetchRecentReviews(dates) })
  const settings = useSettings()
  const reviewsFrom = (settings.data?.[SETTING.reviewsFrom] as string | undefined) ?? null
  const month = useQuery({
    queryKey: ['day-review', 'month', today.slice(0, 7), reviewsFrom],
    queryFn: () => fetchMonth(today.slice(0, 7), today, reviewsFrom),
    enabled: Boolean(settings.data),
  })
  const days = dates.map((date) => ({ date, confirmed: Boolean(reviews.data?.find((x) => x.date === date)?.confirmed_at) }))
  const earlier = (month.data?.notConfirmed ?? []).filter((d) => !dates.includes(d))
  return { today, days, earlier, loaded: reviews.isSuccess }
}
