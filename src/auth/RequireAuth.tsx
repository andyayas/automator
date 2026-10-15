import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from './auth-context'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, session } = useAuth()
  const location = useLocation()

  if (loading) return <div className="splash" aria-busy="true">Loading…</div>
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}
