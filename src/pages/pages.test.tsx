// Screen tests with the data layer mocked. Synthetic names only.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalWithBalance, Client, PackageWithBalance } from '../lib/api'
import { ClientsPage } from './clients/ClientsPage'
import { PackageFormPage } from './clients/PackageFormPage'
import { TodayPage } from './TodayPage'

const api = vi.hoisted(() => ({
  fetchAllClients: vi.fn(),
  fetchClient: vi.fn(),
  fetchPackages: vi.fn(),
  fetchApprovals: vi.fn(),
  fetchPackage: vi.fn(),
  fetchInsurers: vi.fn(),
  setStatus: vi.fn(),
  savePackage: vi.fn(),
  deletePackage: vi.fn(),
  deleteApproval: vi.fn(),
}))
vi.mock('../lib/api', () => api)
vi.mock('../lib/schedule-api', () => ({ fetchSettings: async () => ({}) }))
vi.mock('../lib/day-api', () => ({ fetchRecentReviews: async () => [], fetchMonth: async () => ({ notConfirmed: [], confirmedDates: [] }) }))

const jane = { id: 'c1', name: 'Jane Testerson', phone: '96171000001' }
const omar = { id: 'c2', name: 'Omar Sample', phone: null }

function client(c: { id: string; name: string; phone: string | null }): Client {
  return {
    ...c,
    owner_id: 'u',
    phone_contacts: c.phone,
    phone_override: null,
    contacts_key: c.name.toLowerCase(),
    notes: null,
    active: true,
    created_at: '',
    updated_at: '',
  }
}

function pkg(overrides: Partial<PackageWithBalance>): PackageWithBalance {
  return {
    id: 'p1',
    owner_id: 'u',
    client_id: 'c1',
    client: jane,
    sessions_total: 12,
    price_total: 450,
    per_session: 38,
    purchased_on: '2026-09-01',
    source_voucher: 'rc12',
    amount_paid: 450,
    sessions_used_before_app: 4,
    used_before_app_as_of: '2026-10-14',
    status: 'active',
    notes: null,
    created_at: '',
    updated_at: '',
    sessions_used_in_app: 0,
    sessions_used: 4,
    sessions_remaining: 8,
    last_session_on: null,
    ...overrides,
  }
}

function renderRoute(path: string, routes: Array<{ path: string; element: React.ReactNode }>) {
  const router = createMemoryRouter(
    [...routes, { path: '*', element: <p>elsewhere</p> }],
    { initialEntries: [path] },
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  api.fetchAllClients.mockResolvedValue([client(jane), client(omar)])
  api.fetchClient.mockImplementation(async (id: string) => client(id === 'c1' ? jane : omar))
  api.fetchPackages.mockResolvedValue([])
  api.fetchApprovals.mockResolvedValue([] as ApprovalWithBalance[])
  api.fetchInsurers.mockResolvedValue([])
})

describe('Today', () => {
  it('lists proposals for review and accepts one', async () => {
    api.fetchPackages.mockResolvedValue([pkg({ id: 'prop1', status: 'proposed' }), pkg({ id: 'act1', client: omar, client_id: 'c2', sessions_remaining: 1 })])
    api.setStatus.mockResolvedValue(undefined)
    renderRoute('/', [{ path: '/', element: <TodayPage /> }])

    const review = (await screen.findByRole('heading', { name: /needs your review/i })).closest('section')!
    expect(within(review).getByText('Jane Testerson')).toBeInTheDocument()
    expect(within(review).getByText(/4 used before the app/)).toBeInTheDocument()

    const alerts = screen.getByRole('heading', { name: /alerts/i }).closest('section')!
    expect(within(alerts).getByText('Omar Sample')).toBeInTheDocument()
    expect(within(alerts).getByText('Last session left')).toBeInTheDocument()

    await userEvent.setup().click(within(review).getByRole('button', { name: 'Accept' }))
    expect(api.setStatus).toHaveBeenCalledWith('package', 'prop1', 'active')
  })

  it('leaves active packages to the Clients page', async () => {
    api.fetchPackages.mockResolvedValue([pkg({ id: 'act1', client: omar, client_id: 'c2' })])
    renderRoute('/', [{ path: '/', element: <TodayPage /> }])
    expect(await screen.findByText(/No alerts/)).toBeInTheDocument()
    expect(screen.queryByText('Omar Sample')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /active packages/i })).not.toBeInTheDocument()
  })
})

describe('Clients', () => {
  it('lists packages by default, filters them, and searches everyone under All clients', async () => {
    api.fetchPackages.mockResolvedValue([pkg({}), pkg({ id: 'p2', client: omar, client_id: 'c2', status: 'proposed' })])
    renderRoute('/clients', [{ path: '/clients', element: <ClientsPage /> }])
    const user = userEvent.setup()

    expect(await screen.findByRole('tab', { name: 'Packages', selected: true })).toBeInTheDocument()
    expect(await screen.findByText('Jane Testerson')).toBeInTheDocument()
    expect(screen.getByText('8 of 12 left')).toBeInTheDocument()
    expect(screen.getByText('To review')).toBeInTheDocument()

    await user.type(screen.getByRole('searchbox'), 'oma')
    expect(screen.queryByText('Jane Testerson')).not.toBeInTheDocument()
    expect(screen.getByText('Omar Sample')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'All clients' }))
    expect(await screen.findByText('Omar Sample')).toBeInTheDocument()
    expect(screen.queryByText('Jane Testerson')).not.toBeInTheDocument()
  })

  it('shows approvals on the Insurance tab', async () => {
    renderRoute('/clients?tab=insurance', [{ path: '/clients', element: <ClientsPage /> }])
    expect(await screen.findByText(/No active approvals/)).toBeInTheDocument()
  })
})

describe('Package form', () => {
  it('works out the value per session and saves', async () => {
    api.savePackage.mockResolvedValue(undefined)
    const router = renderRoute('/clients/c1/packages/new', [
      { path: '/clients/:clientId/packages/new', element: <PackageFormPage /> },
    ])
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Sessions'), '12')
    await user.type(screen.getByLabelText('Price ($)'), '450')
    expect(screen.getByLabelText(/Per session/)).toHaveValue('38')

    await user.type(screen.getByLabelText('Sessions already used'), '{backspace}3')
    await user.click(screen.getByRole('button', { name: 'Save package' }))

    expect(api.savePackage).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        client_id: 'c1',
        sessions_total: 12,
        price_total: 450,
        per_session: 38,
        sessions_used_before_app: 3,
        status: 'active',
      }),
    )
    expect(router.state.location.pathname).toBe('/clients/c1')
  })

  it('refuses more used sessions than the package has', async () => {
    renderRoute('/clients/c1/packages/new', [{ path: '/clients/:clientId/packages/new', element: <PackageFormPage /> }])
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Sessions'), '5')
    await user.type(screen.getByLabelText('Price ($)'), '200')
    await user.type(screen.getByLabelText('Sessions already used'), '{backspace}9')
    await user.click(screen.getByRole('button', { name: 'Save package' }))
    expect(screen.getByRole('alert')).toHaveTextContent('between 0 and 5')
    expect(api.savePackage).not.toHaveBeenCalled()
  })
})
