// Google access for reading the clinic's sheet (read-only scope).
//
// She connects once ("Connect Google Sheet"): Google's popup returns a one-time
// code, which the google-token Edge Function swaps for a long-lived refresh
// token that stays on the server. After that any of her devices gets a fresh
// one-hour access token from the function, with no popup. Access tokens are
// kept on the device until they expire; the refresh token never reaches it.

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'
const GIS_SRC = 'https://accounts.google.com/gsi/client'

type CodeResponse = { code?: string; error?: string; error_description?: string }
type CodeClient = { requestCode: () => void }
type GoogleOAuth = {
  initCodeClient: (cfg: {
    client_id: string
    scope: string
    ux_mode: 'popup'
    select_account?: boolean
    callback: (r: CodeResponse) => void
    error_callback?: (e: { type?: string; message?: string }) => void
  }) => CodeClient
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth } }
  }
}

export const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
export const googleConfigured = Boolean(googleClientId)

/** Google isn't connected (or the connection was removed): one tap on "Connect Google Sheet" fixes it. */
export class GoogleNotConnectedError extends Error {
  constructor(message = 'Google is not connected yet.') {
    super(message)
    this.name = 'GoogleNotConnectedError'
  }
}

// ---------- Access token cache (this device) ----------

const STORAGE_KEY = 'google-sheets-token'
type Cached = { token: string; expiresAt: number }
let cached: Cached | null = readStored()

function readStored(): Cached | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Cached | null
    return v && typeof v.token === 'string' && v.expiresAt > Date.now() ? v : null
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

const keep = (r: { access_token: string; expires_in: number }) => {
  store({ token: r.access_token, expiresAt: Date.now() + r.expires_in * 1000 })
  return r.access_token
}

/** Forget this device's access token (e.g. after Google says it is no longer valid). */
export function clearGoogleToken() {
  store(null)
}

// ---------- The google-token Edge Function ----------

type FnReply = { access_token?: string; expires_in?: number; email?: string | null; error?: string; message?: string }

async function callFunction(body: Record<string, string>): Promise<FnReply> {
  // Imported here so modules that only use the pure helpers don't need Supabase settings.
  const { supabase } = await import('./supabase')
  const { data, error } = await supabase.functions.invoke<FnReply>('google-token', { body })
  if (!error) return data ?? {}
  const context = (error as { context?: unknown }).context
  if (context instanceof Response) {
    try {
      return (await context.json()) as FnReply
    } catch {
      // fall through
    }
  }
  throw new Error("Couldn't reach the app's server. Check the internet connection.")
}

/** A valid access token: this device's, else a fresh one from the server. Never opens a popup. */
export async function getGoogleToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
  const r = await callFunction({ action: 'token' })
  if (r.access_token) return keep({ access_token: r.access_token, expires_in: r.expires_in ?? 3600 })
  if (r.error === 'not_connected' || r.error === 'reconnect') throw new GoogleNotConnectedError(r.message)
  throw new Error(r.message ?? 'Google access could not be renewed.')
}

export type GoogleStatus = { connected: boolean; email: string | null; since: string | null }

export async function fetchGoogleStatus(): Promise<GoogleStatus> {
  const { supabase } = await import('./supabase')
  const { data, error } = await supabase.rpc('google_connection_status')
  if (error) throw new Error(error.message)
  const row = data?.[0]
  return { connected: Boolean(row), email: row?.google_email ?? null, since: row?.connected_at ?? null }
}

// ---------- Connecting (one popup, once) ----------

let scriptPromise: Promise<void> | null = null

/** Loads Google's sign-in script. Call it early so the popup opens right on the tap (phones block late popups). */
export function loadGoogleScript(): Promise<void> {
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

/** Opens Google's window, then hands the one-time code to the server. Returns the Google account's email. */
export async function connectGoogle(): Promise<string | null> {
  if (!googleConfigured) throw new Error('Google sign-in is not set up for this app.')
  await loadGoogleScript()
  const oauth = window.google?.accounts?.oauth2
  if (!oauth) throw new Error("Google sign-in didn't load. Reload the page and try again.")
  const code = await new Promise<string>((resolve, reject) => {
    oauth
      .initCodeClient({
        client_id: googleClientId,
        scope: `${SHEETS_SCOPE} openid email`,
        ux_mode: 'popup',
        select_account: true,
        callback: (r) => (r.code ? resolve(r.code) : reject(new Error(r.error_description || r.error || 'Google sign-in failed.'))),
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
      .requestCode()
  })
  const r = await callFunction({ action: 'connect', code })
  if (!r.access_token) throw new Error(r.message ?? 'Google could not be connected.')
  keep({ access_token: r.access_token, expires_in: r.expires_in ?? 3600 })
  return r.email ?? null
}

/** Removes the connection everywhere (the server also revokes it at Google). */
export async function disconnectGoogle(): Promise<void> {
  const r = await callFunction({ action: 'disconnect' })
  if (r.error) throw new Error(r.message ?? 'Could not disconnect Google.')
  clearGoogleToken()
}
