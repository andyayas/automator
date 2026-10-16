import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from './api'
import * as sched from './schedule-api'
import * as day from './day-api'
import { fetchGoogleStatus } from './google'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
  },
})

export const keys = {
  googleStatus: ['google-status'] as const,
  clients: ['clients'] as const,
  client: (id: string) => ['clients', id] as const,
  aliases: (clientId: string) => ['aliases', clientId] as const,
  sessions: (clientId: string) => ['sessions', clientId] as const,
  packages: ['packages'] as const,
  package: (id: string) => ['packages', 'one', id] as const,
  approvals: ['approvals'] as const,
  approval: (id: string) => ['approvals', 'one', id] as const,
  insurers: ['insurers'] as const,
  schedule: (date: string) => ['schedule', date] as const,
  reminders: (date: string) => ['reminders', date] as const,
  settings: ['settings'] as const,
  patterns: ['patterns'] as const,
  dayCash: (date: string) => ['day-cash', date] as const,
  dayReview: (date: string) => ['day-review', date] as const,
  expenseLabels: ['expense-labels'] as const,
  template: ['template'] as const,
  latestCash: ['latest-cash'] as const,
}

export const useClients = () =>
  useQuery({ queryKey: keys.clients, queryFn: api.fetchAllClients, staleTime: 5 * 60_000 })
export const useClient = (id: string) =>
  useQuery({ queryKey: keys.client(id), queryFn: () => api.fetchClient(id), enabled: Boolean(id) })
export const useAliases = (clientId: string) =>
  useQuery({ queryKey: keys.aliases(clientId), queryFn: () => api.fetchAliases(clientId) })
export const useClientSessions = (clientId: string) =>
  useQuery({ queryKey: keys.sessions(clientId), queryFn: () => api.fetchClientSessions(clientId) })

/** Every package and approval with its balance; screens filter in memory (a few hundred rows at most). */
export const usePackages = () => useQuery({ queryKey: keys.packages, queryFn: () => api.fetchPackages() })
export const useApprovals = () => useQuery({ queryKey: keys.approvals, queryFn: () => api.fetchApprovals() })
export const usePackage = (id: string) =>
  useQuery({ queryKey: keys.package(id), queryFn: () => api.fetchPackage(id), enabled: Boolean(id) })
export const useApproval = (id: string) =>
  useQuery({ queryKey: keys.approval(id), queryFn: () => api.fetchApproval(id), enabled: Boolean(id) })
export const useInsurers = () => useQuery({ queryKey: keys.insurers, queryFn: api.fetchInsurers })

// Under 'schedule' so every sheet import refreshes it.
export const useLastSheetRead = () => useQuery({ queryKey: ['schedule', 'last-sheet-read'], queryFn: sched.fetchLastSheetRead })
export const useScheduleDay = (date: string) =>
  useQuery({ queryKey: keys.schedule(date), queryFn: () => sched.fetchScheduleDay(date) })
export const useReminders = (date: string) =>
  useQuery({ queryKey: keys.reminders(date), queryFn: () => sched.fetchReminders(date) })
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: sched.fetchSettings })
export const useGoogleStatus = () => useQuery({ queryKey: keys.googleStatus, queryFn: fetchGoogleStatus, staleTime: 5 * 60_000 })
export const usePatterns = () => useQuery({ queryKey: keys.patterns, queryFn: sched.fetchPatterns })

export const useDayCash = (date: string) => useQuery({ queryKey: keys.dayCash(date), queryFn: () => day.fetchCashForDay(date) })
export const useDayReview = (date: string) => useQuery({ queryKey: keys.dayReview(date), queryFn: () => day.fetchDayReview(date) })
export const useExpenseLabels = () => useQuery({ queryKey: keys.expenseLabels, queryFn: day.fetchExpenseLabels })
export const useTemplateInfo = () => useQuery({ queryKey: keys.template, queryFn: day.templateInfo })
export const useLatestCashDate = () => useQuery({ queryKey: keys.latestCash, queryFn: day.fetchLatestCashDate })

/** Refetch everything that shows packages or approvals after a change. */
export function useInvalidate() {
  const client = useQueryClient()
  return {
    balances: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.packages }),
        client.invalidateQueries({ queryKey: keys.approvals }),
        client.invalidateQueries({ queryKey: keys.insurers }),
      ]),
    clients: () => client.invalidateQueries({ queryKey: keys.clients }),
    schedule: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['schedule'] }),
        client.invalidateQueries({ queryKey: ['reminders'] }),
      ]),
    day: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['day-review'] }),
        client.invalidateQueries({ queryKey: ['day-cash'] }),
        client.invalidateQueries({ queryKey: keys.latestCash }),
        client.invalidateQueries({ queryKey: keys.expenseLabels }),
        client.invalidateQueries({ queryKey: keys.packages }),
        client.invalidateQueries({ queryKey: keys.approvals }),
      ]),
    template: () => client.invalidateQueries({ queryKey: keys.template }),
    settings: () =>
      Promise.all([client.invalidateQueries({ queryKey: keys.settings }), client.invalidateQueries({ queryKey: keys.patterns })]),
    client: (id: string) =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.client(id) }),
        client.invalidateQueries({ queryKey: keys.aliases(id) }),
        client.invalidateQueries({ queryKey: keys.clients, exact: true }),
      ]),
  }
}
