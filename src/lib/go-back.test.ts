import { afterEach, describe, expect, it } from 'vitest'
import { canGoBack } from './go-back'

describe('canGoBack', () => {
  afterEach(() => window.history.replaceState(null, ''))

  it('is true only when an earlier page of the app is in the history', () => {
    window.history.replaceState({ idx: 0 }, '')
    expect(canGoBack()).toBe(false)
    window.history.replaceState({ idx: 2 }, '')
    expect(canGoBack()).toBe(true)
    // A link opened fresh, with no router state yet.
    window.history.replaceState(null, '')
    expect(canGoBack()).toBe(false)
  })
})
