import { describe, expect, it } from 'vitest'
import { DEFAULT_REMINDER_TEMPLATE, renderReminder, tomorrowISO, whatsappUrl } from './reminders'

describe('renderReminder', () => {
  it('fills in the clinic reminder', () => {
    const text = renderReminder(DEFAULT_REMINDER_TEMPLATE, {
      name: 'Jane Testerson',
      date: '2026-10-16',
      slotTime: '19:30:00',
      senderName: 'Test Sender, Test Clinic',
    })
    expect(text).toContain('scheduled for Friday 16 October at 7:30 PM.')
    expect(text.endsWith('Kind regards,\nTest Sender, Test Clinic')).toBe(true)
  })

  it('supports {name} and leaves unknown placeholders alone', () => {
    expect(renderReminder('Hi {name}, {unknown}', { name: 'Omar', date: '2026-10-16', slotTime: '07:00', senderName: '' })).toBe(
      'Hi Omar, {unknown}',
    )
  })
})

describe('whatsappUrl', () => {
  it('builds a wa.me link with the message encoded', () => {
    expect(whatsappUrl('+961 71 000 001', 'Hello,\n• C to confirm')).toBe(
      'https://wa.me/96171000001?text=Hello%2C%0A%E2%80%A2%20C%20to%20confirm',
    )
  })
})

describe('tomorrowISO', () => {
  it('rolls over month ends', () => {
    expect(tomorrowISO(new Date(2026, 9, 31, 20))).toBe('2026-11-01')
  })
})
