// The live sheet refreshes by itself while Google access is valid, and never
// opens Google's window on its own. Synthetic data only.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  hasToken: false,
  readLiveSheet: vi.fn(),
  runScheduleImport: vi.fn(),
}))
vi.mock('../lib/google', () => ({ googleConfigured: true, hasGoogleToken: () => m.hasToken }))
vi.mock('../lib/google-sheets', () => ({ readLiveSheet: m.readLiveSheet }))
vi.mock('../lib/schedule-run', () => ({ loadParseOptions: async () => ({ patterns: [], staffNames: [] }), runScheduleImport: m.runScheduleImport }))
vi.mock('../lib/schedule', () => ({ parseScheduleGrids: () => [{ date: '2026-10-16' }] }))
vi.mock('../lib/queries', () => ({
  useSettings: () => ({ data: { sheet_links: { '2026-10': 'https://docs.google.com/spreadsheets/d/TEST_SHEET_OCT_0123456789/edit', '2026-11': 'https://docs.google.com/spreadsheets/d/TEST_SHEET_NOV_0123456789/edit' } } }),
  useInvalidate: () => ({ schedule: async () => {}, clients: async () => {} }),
}))

const { SheetRefresh } = await import('./SheetRefresh')

beforeEach(() => {
  m.readLiveSheet.mockReset().mockResolvedValue({ title: 'Test', tabs: [], grids: [], contactsRows: null })
  m.runScheduleImport.mockReset().mockResolvedValue({ plan: { unmatched: 0, confirmedChanged: [], replace: new Map() }, phonesUpdated: 0 })
})

describe('SheetRefresh', () => {
  it('waits for a tap when Google has not been connected', async () => {
    m.hasToken = false
    render(<SheetRefresh date="2026-10-16" />)
    expect(screen.getByRole('button', { name: 'Connect Google Sheet' })).toBeInTheDocument()
    expect(m.readLiveSheet).not.toHaveBeenCalled()

    m.hasToken = true
    await userEvent.setup().click(screen.getByRole('button', { name: 'Connect Google Sheet' }))
    await waitFor(() => expect(m.runScheduleImport).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/Live from the Google Sheet · read at/)).toBeInTheDocument()
  })

  it('reads the sheet by itself while connected, then not again for a few minutes', async () => {
    m.hasToken = true
    const first = render(<SheetRefresh date="2026-11-03" />)
    await waitFor(() => expect(m.readLiveSheet).toHaveBeenCalledTimes(1))
    first.unmount()
    // Opening another page soon after doesn't read it again.
    render(<SheetRefresh date="2026-11-03" />)
    await new Promise((r) => setTimeout(r, 50))
    expect(m.readLiveSheet).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Refresh now' })).toBeInTheDocument()
  })
})
