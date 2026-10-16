// @vitest-environment node
// The google-token function with Google and the database faked. Synthetic accounts only.
import { describe, expect, it, vi } from 'vitest'
import { emailFromIdToken, handle, SHEETS_SCOPE, type Connection, type Deps } from './handler.ts'

const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.y`

function setup(googleReplies: Array<Record<string, unknown>>, stored: Connection | null = null) {
  const db = new Map<string, Connection>(stored ? [['user-a', stored]] : [])
  const calls: Array<{ url: string; body: URLSearchParams }> = []
  const fetchFake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body as URLSearchParams })
    return new Response(JSON.stringify(googleReplies.shift() ?? {}))
  })
  const deps: Deps = {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    userId: async (auth) => (auth === 'Bearer valid-login' ? 'user-a' : null),
    store: {
      get: async (o) => db.get(o) ?? null,
      save: async (o, c) => void db.set(o, c),
      remove: async (o) => void db.delete(o),
    },
    fetch: fetchFake as unknown as typeof fetch,
  }
  const call = async (body: unknown, auth = 'Bearer valid-login') => {
    const res = await handle(
      new Request('https://fn.test/google-token', {
        method: 'POST',
        headers: { Authorization: auth, Origin: 'https://andyayas.github.io' },
        body: JSON.stringify(body),
      }),
      deps,
    )
    return { status: res.status, json: (await res.json()) as Record<string, unknown>, headers: res.headers }
  }
  return { db, calls, call }
}

describe('google-token', () => {
  it('refuses callers who are not signed in to the app', async () => {
    const { call, calls } = setup([])
    expect((await call({ action: 'token' }, 'Bearer nonsense')).status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('connects: keeps the refresh token on the server and returns only an access token', async () => {
    const { call, db, calls } = setup([
      { access_token: 'access-1', expires_in: 3599, refresh_token: 'refresh-1', scope: `openid ${SHEETS_SCOPE} email`, id_token: idToken('clinic@example.com') },
    ])
    const r = await call({ action: 'connect', code: 'one-time-code' })
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ access_token: 'access-1', expires_in: 3599, email: 'clinic@example.com' })
    expect(JSON.stringify(r.json)).not.toContain('refresh-1')
    expect(db.get('user-a')?.refresh_token).toBe('refresh-1')
    expect(calls[0].body.get('redirect_uri')).toBe('postmessage')
    expect(calls[0].body.get('client_secret')).toBe('client-secret')
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('https://andyayas.github.io')
  })

  it('refuses a connection without permission to read sheets', async () => {
    const { call, db } = setup([{ access_token: 'a', refresh_token: 'r', scope: 'openid email' }])
    expect((await call({ action: 'connect', code: 'c' })).json.error).toBe('missing_scope')
    expect(db.size).toBe(0)
  })

  it('keeps the earlier refresh token when Google sends none on reconnecting', async () => {
    const { call, db } = setup([{ access_token: 'a2', scope: SHEETS_SCOPE }], { google_email: 'clinic@example.com', refresh_token: 'refresh-old', scope: SHEETS_SCOPE })
    expect((await call({ action: 'connect', code: 'c' })).status).toBe(200)
    expect(db.get('user-a')?.refresh_token).toBe('refresh-old')
  })

  it('asks to reset Google permissions when there is no refresh token at all', async () => {
    const { call } = setup([{ access_token: 'a', scope: SHEETS_SCOPE }])
    expect((await call({ action: 'connect', code: 'c' })).json.error).toBe('no_refresh_token')
  })

  it('hands out fresh access tokens from the stored refresh token', async () => {
    const { call, calls } = setup([{ access_token: 'access-2', expires_in: 3599 }], { google_email: 'clinic@example.com', refresh_token: 'refresh-1', scope: SHEETS_SCOPE })
    const r = await call({ action: 'token' })
    expect(r.json).toEqual({ access_token: 'access-2', expires_in: 3599, email: 'clinic@example.com' })
    expect(calls[0].body.get('grant_type')).toBe('refresh_token')
    expect(calls[0].body.get('refresh_token')).toBe('refresh-1')
  })

  it('says when Google is not connected, and forgets a connection Google revoked', async () => {
    expect((await setup([]).call({ action: 'token' })).json.error).toBe('not_connected')
    const revoked = setup([{ error: 'invalid_grant' }], { google_email: null, refresh_token: 'gone', scope: SHEETS_SCOPE })
    expect((await revoked.call({ action: 'token' })).json.error).toBe('reconnect')
    expect(revoked.db.size).toBe(0)
  })

  it('disconnects: revokes at Google and forgets the token', async () => {
    const { call, db, calls } = setup([{}], { google_email: null, refresh_token: 'refresh-1', scope: SHEETS_SCOPE })
    expect((await call({ action: 'disconnect' })).json).toEqual({ ok: true })
    expect(calls[0].url).toContain('/revoke')
    expect(db.size).toBe(0)
  })

  it('reads the email from an id token', () => {
    expect(emailFromIdToken(idToken('a@example.com'))).toBe('a@example.com')
    expect(emailFromIdToken('garbage')).toBeNull()
  })
})
