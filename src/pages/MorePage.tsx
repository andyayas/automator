import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/auth-context'

export function MorePage() {
  const { session, signOut } = useAuth()
  const [signingOut, setSigningOut] = useState(false)

  return (
    <section className="page">
      <h1>More</h1>

      <div className="card list">
        <Link to="/more/import-contacts" className="list-row link">
          <span className="row-text">
            <span>Import clients</span>
            <span className="muted small">From the schedule's Contacts tab</span>
          </span>
          <span className="chevron" aria-hidden="true">
            ›
          </span>
        </Link>
        <Link to="/more/cash" className="list-row link">
          <span className="row-text">
            <span>Upload cash statement</span>
            <span className="muted small">Read on this device; only the rows are saved</span>
          </span>
          <span className="chevron" aria-hidden="true">
            ›
          </span>
        </Link>
        <Link to="/more/settings" className="list-row link">
          <span className="row-text">
            <span>Settings</span>
            <span className="muted small">Reminder message, sender name, sheet links, staff</span>
          </span>
          <span className="chevron" aria-hidden="true">
            ›
          </span>
        </Link>
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
