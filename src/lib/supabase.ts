import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

// Both values are public by design (they ship in the bundle); RLS protects the data.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (see .env.example).')
}

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    flowType: 'pkce',
    // Stay signed in on each device until she signs out.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
