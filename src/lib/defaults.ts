// Starting values copied into her account the first time they're needed.
// She edits them in Settings; the app never resets them.

export { DEFAULT_NON_CLIENT_PATTERNS } from './schedule-cell'
export { DEFAULT_REMINDER_TEMPLATE } from './reminders'

/** Expense label mapping (CLAUDE.md), keyed by "name|description" lowercased. */
export const DEFAULT_EXPENSE_LABELS: Record<string, string> = {
  'alfa|phone recharge': 'Alfa phone recharge',
  'bartartine|coffee': 'Coffee',
  'coco laundry|laundry': 'Laundry',
  'cream|cream for the team': 'Cream',
  'maliks|ink+stationery': 'Maliks Ink+Stationery',
  'ogero|fiber internet': 'Fiber',
  'sannine water|5 boxes of water': 'Water 5 boxes',
  'sannine water|10 boxes of water': 'Water 10 boxes',
  'sclub|rent': 'Rent',
  'toters|pantry': 'Pantry toters',
  'univest|medical rolls': 'Medical Rolls',
  'we for media|social media': 'Social media',
}

/** Setting keys (settings table, key -> JSON). */
export const SETTING = {
  defaultsSeeded: 'defaults_seeded',
  senderName: 'sender_name',
  reminderTemplate: 'reminder_template',
  /** The check-in message for clients who haven't been back for 30 days. */
  checkinTemplate: 'checkin_template',
  staffNames: 'staff_names',
  sheetLinks: 'sheet_links',
  perSessionPrice: 'per_session_price',
  insuranceBilled: 'insurance_billed',
  /** The cash statement's file password, kept in her private settings (RLS), never in code. */
  cashPassword: 'cash_password',
  /** First day reviewed in the app; earlier days were reported by hand. */
  reviewsFrom: 'reviews_from',
  /** Emails that get edit access to each new month's sheet. */
  shareWith: 'sheet_share_with',
} as const

/** Used when a setting hasn't been set yet. */
export const DEFAULT_PRICES = { perSessionPrice: 45, insuranceBilled: 25 }
