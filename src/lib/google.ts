// Google sign-in for reading the clinic's sheet (Google Identity Services,
// token model). Read-only scope. The access token lasts about an hour and is
// kept on this device until then (so reopening the app keeps reading the
// sheet); after that Google has to be asked again, which needs a tap.

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'
const GIS_SRC = 'https://accounts.google.com/gsi/client'

type TokenResponse = { access_token?: string; expires_in?: number; error?: string; error_description?: string }
type TokenClient = { requestAccessToken: (opts?: { prompt?: string }) => void }
type GoogleOAuth = {
  initTokenClient: (cfg: {
    client_id: string
    scope: string
    callback: (r: TokenResponse) => void
    error_callback?: (e: { type?: string; message?: string }) => void
  }) => TokenClient
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth } }
  }
}

export const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
export const googleConfigured = Boolean(googleClientId)

let scriptPromise: Promise<void> | null = null
const STORAGE_KEY = 'google-sheets-token'
type Cached = { token: string; expiresAt: number }
let cached: Cached | null = readStored()

function readStored(): Cached | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Cached | null
    // An expired one is kept too: it tells Google she already agreed, so it doesn't ask again.
    return v && typeof v.token === 'string' && typeof v.expiresAt === 'number' ? v : null
  } catch {
    return null
  }
}

function store(v: Cached | null) {
  cached = v
  try {
    if (v) localStorage.setItem(STORAGE_KEY, JSON.stringify(v))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Private mode or storage blocked: the token still works for this visit.
  }
}

/** True while a token is valid, so the sheet can be read without asking Google (no popup). */
export function hasGoogleToken(): boolean {
  return Boolean(cached && cached.expiresAt > Date.now() + 60_000)
}

function loadScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = GIS_SRC
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      scriptPromise = null
      reject(new Error("Couldn't reach Google. Check the internet connection."))
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

/** A valid access token, asking Google (popup) when there isn't one yet. */
export async function getGoogleToken(): Promise<string> {
  if (cached && hasGoogleToken()) return cached.token
  if (!googleConfigured) throw new Error('Google sign-in is not set up for this app.')
  await loadScript()
  const oauth = window.google?.accounts?.oauth2
  if (!oauth) throw new Error("Google sign-in didn't load. Reload the page and try again.")
  return new Promise<string>((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: googleClientId,
      scope: SCOPE,
      callback: (r) => {
        if (!r.access_token) return reject(new Error(r.error_description || r.error || 'Google sign-in failed.'))
        store({ token: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 })
        resolve(r.access_token)
      },
      error_callback: (e) =>
        reject(
          new Error(
            e.type === 'popup_closed'
              ? 'The Google window was closed before signing in.'
              : e.type === 'popup_failed_to_open'
                ? 'The browser blocked the Google window. Allow pop-ups for this site and try again.'
                : e.message || 'Google sign-in failed.',
          ),
        ),
    })
    client.requestAccessToken({ prompt: cached ? '' : undefined })
  })
}

/** Forget the token (e.g. after Google says it is no longer valid). */
export function clearGoogleToken() {
  store(null)
}
