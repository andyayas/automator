// The google-token Edge Function, without Deno or Supabase wiring so it can be
// unit-tested (index.ts supplies the real store, login check and fetch).
//
// Actions (POST JSON, with her Supabase login as the bearer token):
//   connect    { code }  one-time code from her "Connect Google" tap -> keeps
//                        the refresh token, returns a fresh access token
//   token                a fresh access token (about an hour) from the kept refresh token
//   disconnect           revokes the refresh token at Google and forgets it
// The refresh token never leaves the server; only short-lived access tokens do.

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

export type Connection = { google_email: string | null; refresh_token: string; scope: string }

export type Deps = {
  clientId: string
  clientSecret: string
  /** The Supabase user id behind the Authorization header, or null if it isn't a valid login. */
  userId: (authorization: string | null) => Promise<string | null>
  store: {
    get: (owner: string) => Promise<Connection | null>
    save: (owner: string, c: Connection) => Promise<void>
    remove: (owner: string) => Promise<void>
  }
  fetch: typeof fetch
}

const ALLOWED_ORIGINS = ['https://andyayas.github.io']
const isAllowedOrigin = (o: string) => ALLOWED_ORIGINS.includes(o) || /^http:\/\/localhost:\d+$/.test(o)

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  return {
    ...(isAllowedOrigin(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

type GoogleToken = { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string; id_token?: string; error?: string }

/** The email in a Google id_token (straight from Google over TLS, so it isn't re-verified). */
export function emailFromIdToken(idToken: string | undefined): string | null {
  const payload = idToken?.split('.')[1]
  if (!payload) return null
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { email?: unknown }
    return typeof json.email === 'string' ? json.email : null
  } catch {
    return null
  }
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const headers = cors(req)
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
  const fail = (status: number, error: string, message: string) => reply(status, { error, message })

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return fail(405, 'bad_request', 'Use POST.')

  const owner = await deps.userId(req.headers.get('Authorization'))
  if (!owner) return fail(401, 'unauthorized', 'Sign in to the app first.')

  let body: { action?: unknown; code?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return fail(400, 'bad_request', 'Expected JSON.')
  }

  const google = async (params: Record<string, string>): Promise<GoogleToken> => {
    const res = await deps.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: deps.clientId, client_secret: deps.clientSecret, ...params }),
    })
    return (await res.json()) as GoogleToken
  }

  if (body.action === 'connect') {
    if (typeof body.code !== 'string' || !body.code) return fail(400, 'bad_request', 'Missing code.')
    // 'postmessage' is the redirect URI Google's popup code flow uses.
    const t = await google({ grant_type: 'authorization_code', code: body.code, redirect_uri: 'postmessage' })
    if (!t.access_token) return fail(502, 'google_error', `Google refused the connection (${t.error ?? 'unknown error'}).`)
    const scope = t.scope ?? ''
    if (!scope.split(' ').includes(SHEETS_SCOPE)) {
      return fail(400, 'missing_scope', 'Google sign-in finished without permission to see the sheet. Connect again and tick the Google Sheets box.')
    }
    const email = emailFromIdToken(t.id_token)
    // Google only sends a refresh token the first time she agrees; keep the old one otherwise.
    const refresh = t.refresh_token ?? (await deps.store.get(owner))?.refresh_token
    if (!refresh) {
      return fail(
        409,
        'no_refresh_token',
        'Google did not give a lasting connection. Remove "Clinic Admin" at myaccount.google.com/permissions, then connect again.',
      )
    }
    await deps.store.save(owner, { google_email: email, refresh_token: refresh, scope })
    return reply(200, { access_token: t.access_token, expires_in: t.expires_in ?? 3600, email })
  }

  if (body.action === 'token') {
    const c = await deps.store.get(owner)
    if (!c) return fail(404, 'not_connected', 'Google is not connected yet.')
    const t = await google({ grant_type: 'refresh_token', refresh_token: c.refresh_token })
    if (!t.access_token) {
      if (t.error === 'invalid_grant') {
        // Revoked in her Google account, or the password changed: she has to connect again.
        await deps.store.remove(owner)
        return fail(409, 'reconnect', 'The Google connection was removed or expired. Connect again.')
      }
      return fail(502, 'google_error', `Google did not renew access (${t.error ?? 'unknown error'}).`)
    }
    return reply(200, { access_token: t.access_token, expires_in: t.expires_in ?? 3600, email: c.google_email })
  }

  if (body.action === 'disconnect') {
    const c = await deps.store.get(owner)
    if (c) {
      // Best effort: forget it here even if Google can't be reached.
      await deps
        .fetch(REVOKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: c.refresh_token }) })
        .catch(() => undefined)
      await deps.store.remove(owner)
    }
    return reply(200, { ok: true })
  }

  return fail(400, 'bad_request', 'Unknown action.')
}
