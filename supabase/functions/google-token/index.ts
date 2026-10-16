// Deno entry point for the google-token Edge Function. The logic is in handler.ts.
// Secrets (set with `supabase secrets set`, never in the repo): GOOGLE_CLIENT_ID,
// GOOGLE_CLIENT_SECRET. SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { handle, type Connection } from './handler.ts'

const env = (name: string) => {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`Missing ${name}`)
  return v
}

const url = env('SUPABASE_URL')
const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const anon = createClient(url, env('SUPABASE_ANON_KEY'), { auth: { persistSession: false } })

const check = (error: { message: string } | null) => {
  if (error) throw new Error(error.message)
}

Deno.serve((req) =>
  handle(req, {
    clientId: env('GOOGLE_CLIENT_ID'),
    clientSecret: env('GOOGLE_CLIENT_SECRET'),
    userId: async (authorization) => {
      const jwt = authorization?.replace(/^Bearer\s+/i, '')
      if (!jwt) return null
      const { data } = await anon.auth.getUser(jwt)
      return data.user?.id ?? null
    },
    store: {
      get: async (owner) => {
        const { data, error } = await admin.rpc('google_connection_get', { p_owner: owner })
        check(error)
        return ((data as Connection[] | null) ?? [])[0] ?? null
      },
      save: async (owner, c) => {
        const { error } = await admin.rpc('google_connection_save', {
          p_owner: owner,
          p_email: c.google_email,
          p_refresh_token: c.refresh_token,
          p_scope: c.scope,
        })
        check(error)
      },
      remove: async (owner) => {
        const { error } = await admin.rpc('google_connection_delete', { p_owner: owner })
        check(error)
      },
    },
    fetch,
  }),
)
