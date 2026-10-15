// Google sign-in for reading the clinic's sheet (Google Identity Services,
// token model). Read-only scope; the access token lives in memory only and
// lasts about an hour, after which the next refresh asks Google again.

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
let cached: { token: string; expiresAt: number } | null = null

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
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
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
        cached = { token: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 }
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
  cached = null
}
