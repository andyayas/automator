import { describe, expect, it } from 'vitest'
import { formatTime } from './format'

describe('formatTime', () => {
  it('writes times like the clinic: 12-hour with AM/PM', () => {
    expect(formatTime(new Date(2026, 9, 16, 13, 20))).toBe('1:20 PM')
    expect(formatTime(new Date(2026, 9, 16, 9, 5))).toBe('9:05 AM')
  })
})
