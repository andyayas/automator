import type { WorkBook } from 'xlsx'
import { parseContactsRows, type ContactsParseResult } from './contacts'
import { sheetRows } from './sheet-rows'

/** Reads the Contacts tab of a schedule export: column A name, column B phone. */
export function parseContacts(workbook: WorkBook): ContactsParseResult {
  const sheetName = workbook.SheetNames.find((n) => n.trim().toLowerCase() === 'contacts')
  if (!sheetName) throw new Error('This file has no "Contacts" tab. Upload the schedule export.')
  return parseContactsRows(sheetRows(workbook.Sheets[sheetName]))
}
