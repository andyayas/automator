// The live sheet refreshes by itself once Google is connected, and only opens
// Google's window when she taps Connect. Synthetic data only.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  connected: false,
  readLiveSheet: vi.fn(),
  runScheduleImport: vi.fn(),
  connectGoogle: vi.fn(),
}))
vi.mock('../lib/google', () => ({
  googleConfigured: true,
  connectGoogle: m.connectGoogle,
  loadGoogleScript: async () => {},
  GoogleNotConnectedError: class extends Error {},
}))
vi.mock('../lib/google-sheets', () => ({ readLiveSheet: m.readLiveSheet }))
vi.mock('../lib/schedule-run', () => ({ loadParseOptions: async () => ({ patterns: [], staffNames: [] }), runScheduleImport: m.runScheduleImport }))
vi.mock('../lib/schedule', () => ({ parseScheduleGrids: () => [{ date: '2026-10-16' }] }))
vi.mock('../lib/queries', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return {
    keys: { googleStatus: ['google-status'] },
    useGoogleStatus: () => useQuery({ queryKey: ['google-status'], queryFn: async () => ({ connected: m.connected, email: null, since: null }) }),
    useSettings: () => ({
      data: {
        sheet_links: {
          '2026-10': 'https://docs.google.com/spreadsheets/d/TEST_SHEET_OCT_0123456789/edit',
          '2026-11': 'https://docs.google.com/spreadsheets/d/TEST_SHEET_NOV_0123456789/edit',
        },
      },
    }),
    useInvalidate: () => ({ schedule: async () => {}, clients: async () => {} }),
    useLastSheetRead: () => ({ data: null }),
  }
})

const { SheetRefresh } = await import('./SheetRefresh')

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

beforeEach(() => {
  m.readLiveSheet.mockReset().mockResolvedValue({ title: 'Test', tabs: [], grids: [], contactsRows: null })
  m.runScheduleImport.mockReset().mockResolvedValue({ plan: { unmatched: 0, confirmedChanged: [], replace: new Map() }, phonesUpdated: 0 })
  m.connectGoogle.mockReset().mockImplementation(async () => {
    m.connected = true
    return 'clinic@example.com'
  })
})

describe('SheetRefresh', () => {
  it('waits for a tap when Google is not connected, then reads the sheet', async () => {
    m.connected = false
    render(wrap(<SheetRefresh date="2026-10-16" />))
    const button = await screen.findByRole('button', { name: 'Connect Google Sheet' })
    expect(m.readLiveSheet).not.toHaveBeenCalled()
    expect(m.connectGoogle).not.toHaveBeenCalled()

    await userEvent.setup().click(button)
    expect(m.connectGoogle).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(m.runScheduleImport).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Live from the sheet · \d{1,2}:\d{2} (AM|PM)/))
  })

  it('reads the sheet by itself once connected, then not again for a few minutes', async () => {
    m.connected = true
    const first = render(wrap(<SheetRefresh date="2026-11-03" />))
    await waitFor(() => expect(m.readLiveSheet).toHaveBeenCalledTimes(1))
    first.unmount()
    // Opening another page soon after doesn't read it again.
    render(wrap(<SheetRefresh date="2026-11-03" />))
    expect(await screen.findByRole('button', { name: 'Refresh now' })).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 50))
    expect(m.readLiveSheet).toHaveBeenCalledTimes(1)
    expect(m.connectGoogle).not.toHaveBeenCalled()
  })
})
