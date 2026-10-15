import { useState } from 'react'
import { useAuth } from '../auth/auth-context'

export function MorePage() {
  const { session, signOut } = useAuth()
  const [signingOut, setSigningOut] = useState(false)

  return (
    <section className="page">
      <h1>More</h1>

      <div className="card list">
        <div className="list-row">
          <span>Settings</span>
          <span className="muted">Coming soon</span>
        </div>
        <div className="list-row">
          <span>Export all data</span>
          <span className="muted">Coming soon</span>
        </div>
      </div>

      <div className="card">
        <p className="muted">Signed in as</p>
        <p className="strong">{session?.user.email}</p>
        <button
          className="button block"
          type="button"
          disabled={signingOut}
          onClick={async () => {
            setSigningOut(true)
            await signOut()
          }}
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>

      <p className="muted small center">
        Version {__APP_VERSION__} · {__BUILD_SHA__}
      </p>
    </section>
  )
}
