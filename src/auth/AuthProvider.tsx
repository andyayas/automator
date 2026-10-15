import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { AuthContext, type AuthContextValue } from './auth-context'
import { loginErrorMessage } from './login-errors'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const queryClient = useQueryClient()
  const userId = useRef<string | null>(null)

  useEffect(() => {
    // Fires INITIAL_SESSION straight away with the saved session (or null).
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      // Never show one account's cached data to another (or after sign-out).
      const nextId = next?.user.id ?? null
      if (nextId !== userId.current) queryClient.clear()
      userId.current = nextId
      setSession(next)
      setLoading(false)
    })
    return () => data.subscription.unsubscribe()
  }, [queryClient])

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      session,
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        return error ? loginErrorMessage(error) : null
      },
      signOut: async () => {
        await supabase.auth.signOut()
      },
    }),
    [loading, session],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
