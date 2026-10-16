// Reads the clinic's Google Sheet through the Sheets API (read-only) and turns
// it into the same grids the file upload produces, so one parser serves both.

import { clearGoogleToken, getGoogleToken } from './google'
import type { SheetGrid } from './schedule'
import { buildMonthSheet, monthTitle } from './month-sheet'

export type SheetTab = { title: string; gid: number }
export type LiveSheet = { spreadsheetId: string; title: string; tabs: SheetTab[]; grids: SheetGrid[]; contactsRows: unknown[][] | null }

/** The spreadsheet id from a sheet link (…/spreadsheets/d/<id>/edit…). */
export function spreadsheetIdFromUrl(url: string): string | null {
  return /\/spreadsheets\/d\/([\w-]{20,})/.exec(url)?.[1] ?? null
}

/** A1 range for a tab title; titles are quoted and apostrophes doubled. */
export function tabRange(title: string, range: string): string {
  return `'${title.replace(/'/g, "''")}'!${range}`
}

/** Link straight to a day's tab. */
export function tabUrl(sheetUrl: string, gid: number | undefined): string {
  const id = spreadsheetIdFromUrl(sheetUrl)
  if (!id) return sheetUrl
  return `https://docs.google.com/spreadsheets/d/${id}/edit${gid !== undefined ? `#gid=${gid}` : ''}`
}

const isContacts = (title: string) => title.trim().toLowerCase() === 'contacts'

/** Combines the API's value ranges with the tab list (ranges come back in request order). */
export function toGrids(tabs: SheetTab[], valueRanges: Array<{ values?: unknown[][] }>): { grids: SheetGrid[]; contactsRows: unknown[][] | null } {
  const grids: SheetGrid[] = []
  let contactsRows: unknown[][] | null = null
  tabs.forEach((tab, i) => {
    const rows = valueRanges[i]?.values ?? []
    if (isContacts(tab.title)) contactsRows = rows
    else grids.push({ name: tab.title, rows })
  })
  return { grids, contactsRows }
}

async function api<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (res.ok) return (await res.json()) as T
  if (res.status === 401) clearGoogleToken()
  throw new Error(
    res.status === 403
      ? "The connected Google account can't open this sheet. In Settings, disconnect Google and connect the account the sheet is shared with."
      : res.status === 404
        ? 'Sheet not found. Check the sheet link in Settings.'
        : res.status === 401
          ? 'Google access expired. Refresh again.'
          : `Google Sheets error (${res.status}).`,
  )
}

/** Reads every tab of the sheet (day tabs A1:I36, Contacts A:B) in one request. */
export async function readLiveSheet(sheetUrl: string): Promise<LiveSheet> {
  const spreadsheetId = spreadsheetIdFromUrl(sheetUrl)
  if (!spreadsheetId) throw new Error('That sheet link does not look right. Check it in Settings.')
  const token = await getGoogleToken()
  const meta = await api<{ properties: { title: string }; sheets: Array<{ properties: { sheetId: number; title: string } }> }>(
    token,
    `${spreadsheetId}?fields=properties.title,sheets.properties(sheetId,title)`,
  )
  const tabs = meta.sheets.map((s) => ({ title: s.properties.title, gid: s.properties.sheetId }))
  const params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' })
  for (const t of tabs) params.append('ranges', tabRange(t.title, isContacts(t.title) ? 'A1:B6000' : 'A1:I36'))
  const values = await api<{ valueRanges: Array<{ values?: unknown[][] }> }>(token, `${spreadsheetId}/values:batchGet?${params}`)
  return { spreadsheetId, title: meta.properties.title, tabs, ...toGrids(tabs, values.valueRanges) }
}

// ---------- Creating next month's sheet ----------

async function send<T>(token: string, url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (res.ok) return (await res.json()) as T
  if (res.status === 401) clearGoogleToken()
  const detail = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message
  throw new Error(
    res.status === 403
      ? 'Google didn’t allow this. In Settings, tap Connect Google again and allow the app to create its sheets.'
      : `Google error (${res.status})${detail ? `: ${detail}` : ''}.`,
  )
}

/**
 * Creates `month`'s schedule sheet in the connected Google account (the
 * clinic's design, see month-sheet.ts) and shares it with `shareWith` (edit
 * access, with Google's email). Returns its link.
 */
export async function createMonthSheet(month: string, therapists: string[], shareWith: string[]): Promise<{ url: string; title: string; shared: string[] }> {
  const token = await getGoogleToken()
  const created = await send<{ spreadsheetId: string }>(
    token,
    'https://sheets.googleapis.com/v4/spreadsheets?fields=spreadsheetId',
    buildMonthSheet(month, therapists),
  )
  const shared: string[] = []
  for (const email of shareWith) {
    await send(token, `https://www.googleapis.com/drive/v3/files/${created.spreadsheetId}/permissions?sendNotificationEmail=true`, {
      type: 'user',
      role: 'writer',
      emailAddress: email,
    })
    shared.push(email)
  }
  return { url: `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}/edit`, title: monthTitle(month), shared }
}
