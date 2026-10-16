import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from './auth/AuthProvider'
import { routes } from './routes'

type Listener = (event: string, session: unknown) => void

const auth = vi.hoisted(() => {
  const state = { session: null as unknown, listeners: [] as Array<(event: string, session: unknown) => void> }
  return {
    state,
    emit(session: unknown) {
      state.session = session
      for (const listener of state.listeners) listener('SIGNED_IN', session)
    },
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
  }
})

vi.mock('./lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (listener: Listener) => {
        auth.state.listeners.push(listener)
        queueMicrotask(() => listener('INITIAL_SESSION', auth.state.session))
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signInWithPassword: auth.signInWithPassword,
      signOut: auth.signOut,
    },
  },
}))

vi.mock('./lib/api', () => ({
  fetchAllClients: async () => [],
  fetchPackages: async () => [],
  fetchApprovals: async () => [],
  fetchInsurers: async () => [],
}))

const fakeSession = { user: { id: 'user-1', email: 'admin@example.com' } }

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => {
  auth.state.session = null
  auth.state.listeners = []
  auth.signInWithPassword.mockReset()
  auth.signOut.mockReset()
})

describe('signed out', () => {
  it('sends every screen to the login page', async () => {
    const router = renderAt('/clients')
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('shows a clear message for a wrong password', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { code: 'invalid_credentials', status: 400 } })
    renderAt('/')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Email'), 'admin@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.')
  })

  it('returns to the requested screen after signing in', async () => {
    auth.signInWithPassword.mockImplementation(async () => {
      auth.emit(fakeSession)
      return { error: null }
    })
    const router = renderAt('/reminders')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Email'), ' admin@example.com ')
    await user.type(screen.getByLabelText('Password'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('heading', { name: 'Reminders' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/reminders')
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'admin@example.com', password: 'secret' })
  })
})

describe('signed in', () => {
  beforeEach(() => {
    auth.state.session = fakeSession
  })

  it('shows the five navigation tabs', async () => {
    renderAt('/')
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    const labels = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent)
    expect(labels).toEqual(['Today', 'Schedule', 'Clients', 'Reminders', 'More'])
    expect(screen.getByRole('link', { name: 'Today' })).toHaveClass('active')
  })

  it('navigates between tabs', async () => {
    renderAt('/')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('link', { name: 'Schedule' }))
    expect(screen.getByRole('heading', { name: 'Schedule' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Schedule' })).toHaveClass('active')
  })

  it('redirects away from the login page', async () => {
    const router = renderAt('/login')
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('sends unknown paths to Today', async () => {
    const router = renderAt('/nope')
    await screen.findByRole('navigation', { name: 'Main' })
    // The redirect can land a moment after the menu appears.
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('signs out from More', async () => {
    auth.signOut.mockImplementation(async () => {
      await act(async () => auth.emit(null))
    })
    renderAt('/more')
    expect(await screen.findByText('admin@example.com')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }))
    expect(auth.signOut).toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })
})
