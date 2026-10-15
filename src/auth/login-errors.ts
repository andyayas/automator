type AuthErrorLike = { code?: string; status?: number; name?: string; message?: string }

/** Turns a Supabase auth error into a sentence she can act on. */
export function loginErrorMessage(error: AuthErrorLike): string {
  if (error.code === 'invalid_credentials') return 'Wrong email or password.'
  if (error.code === 'email_not_confirmed') return 'This account has not been confirmed yet.'
  if (error.code === 'user_banned') return 'This account has been disabled.'
  if (error.status === 429 || error.code === 'over_request_rate_limit') {
    return 'Too many attempts. Wait a minute and try again.'
  }
  if (error.name === 'AuthRetryableFetchError' || error.status === 0) {
    return "Can't reach the server. Check your internet connection and try again."
  }
  return 'Could not sign in. Please try again.'
}
