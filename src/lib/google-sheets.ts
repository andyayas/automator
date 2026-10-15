// Reads the clinic's Google Sheet through the Sheets API (read-only) and turns
// it into the same grids the file upload produces, so one parser serves both.

import { clearGoogleToken, getGoogleToken } from './google'
import type { SheetGrid } from './schedule'

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
      ? "This Google account can't open the sheet. Sign in with the account that has access to it."
      : res.status === 404
        ? 'Sheet not found. Check the sheet link in Settings.'
        : res.status === 401
          ? 'Google sign-in expired. Tap refresh again.'
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
