import type { Session } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'

export type AuthContextValue = {
  /** True until Supabase has restored (or ruled out) a saved session. */
  loading: boolean
  session: Session | null
  /** Resolves to a message for the user, or null on success. */
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
