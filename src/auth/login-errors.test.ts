import { describe, expect, it } from 'vitest'
import { loginErrorMessage } from './login-errors'

describe('loginErrorMessage', () => {
  it('explains wrong credentials', () => {
    expect(loginErrorMessage({ code: 'invalid_credentials', status: 400 })).toBe('Wrong email or password.')
  })

  it('explains rate limiting', () => {
    expect(loginErrorMessage({ status: 429 })).toMatch(/too many attempts/i)
  })

  it('explains being offline', () => {
    expect(loginErrorMessage({ name: 'AuthRetryableFetchError', status: 0 })).toMatch(/can't reach the server/i)
  })

  it('falls back to a generic message', () => {
    expect(loginErrorMessage({ code: 'something_new', status: 500 })).toBe('Could not sign in. Please try again.')
  })
})
