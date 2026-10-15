import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../auth/auth-context'

export function LoginPage() {
  const { loading, session, signIn } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loading) return <div className="splash" aria-busy="true">Loading…</div>
  if (session) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    const message = await signIn(email, password)
    // On success the auth listener updates the session and the redirect above runs.
    if (message) {
      setError(message)
      setSubmitting(false)
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={onSubmit} noValidate>
        <h1>Clinic Admin</h1>
        <p className="muted">Sign in to continue.</p>

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Password</span>
          <div className="password-row">
            <input
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="button ghost"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button className="button primary block" type="submit" disabled={submitting || !email || !password}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
