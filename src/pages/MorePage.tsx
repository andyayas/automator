import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { ContactsIcon, SettingsIcon, SheetIcon, UploadIcon } from '../layout/icons'

const OPTIONS: Array<{ to: string; title: string; hint: string; icon: ReactNode }> = [
  { to: '/more/create-sheet', title: 'New month sheet', hint: 'A Google Sheet in the clinic’s design', icon: <SheetIcon /> },
  { to: '/more/settings', title: 'Settings', hint: 'Sheet links, Google, reminder message', icon: <SettingsIcon /> },
  { to: '/more/cash', title: 'Upload cash statement', hint: 'Read on this device; only the rows are saved', icon: <UploadIcon /> },
  { to: '/more/import-contacts', title: 'Import clients', hint: 'From the phone’s contacts (.vcf)', icon: <ContactsIcon /> },
]

export function MorePage() {
  const { session, signOut } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  const email = session?.user.email ?? ''

  return (
    <section className="page more">
      <h1>More</h1>

      <div className="card list">
        {OPTIONS.map((o) => (
          <Link key={o.to} to={o.to} className="list-row link task-row">
            <span className="task-icon accent">{o.icon}</span>
            <span className="row-text grow">
              <span className="strong">{o.title}</span>
              <span className="muted small">{o.hint}</span>
            </span>
            <span className="chevron" aria-hidden="true">
              ›
            </span>
          </Link>
        ))}
      </div>

      <div className="card account">
        <span className="avatar" aria-hidden="true">
          {email.slice(0, 1).toUpperCase()}
        </span>
        <span className="row-text grow">
          <span className="muted small">Signed in as</span>
          <span className="strong truncate">{email}</span>
        </span>
        <button
          className="button small-button"
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
