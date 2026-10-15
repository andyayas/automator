// One import path for both sources (uploaded export, live Google Sheet):
// refresh phones from Contacts, match names, replace unconfirmed days.

import { applyContactsImport, fetchAllClients } from './api'
import type { ContactRow } from './contacts'
import { planContactsImport } from './contacts-plan'
import type { Json } from './database.types'
import { SETTING } from './defaults'
import { createNameMatcher } from './names'
import type { ScheduleDay } from './schedule'
import type { NonClientPattern } from './schedule-cell'
import {
  applyScheduleImport,
  ensureDefaults,
  fetchAllAliases,
  fetchConfirmedDates,
  fetchPatterns,
  fetchSettings,
  fetchStoredBookings,
} from './schedule-api'
import { planScheduleImport, type ScheduleImportPlan } from './schedule-import'

/** Her non-client list and staff names, for the cell parser. */
export async function loadParseOptions(): Promise<{ patterns: NonClientPattern[]; staffNames: string[] }> {
  await ensureDefaults()
  const [patterns, settings] = await Promise.all([fetchPatterns(), fetchSettings()])
  return {
    patterns: patterns.map((p) => ({ pattern: p.pattern, match_type: p.match_type as NonClientPattern['match_type'] })),
    staffNames: (settings[SETTING.staffNames] as string[] | undefined) ?? [],
  }
}

export async function runScheduleImport(
  input: { days: ScheduleDay[]; contacts: ContactRow[] | null; source: string; details?: Record<string, Json> },
  onStep: (label: string) => void = () => {},
): Promise<{ plan: ScheduleImportPlan; contactsAdded: number; phonesUpdated: number }> {
  let contactsAdded = 0
  let phonesUpdated = 0
  if (input.contacts) {
    const [clients, aliases] = await Promise.all([fetchAllClients(), fetchAllAliases()])
    const contactsPlan = planContactsImport(input.contacts, clients, 'sheet', aliases)
    if (contactsPlan.inserts.length + contactsPlan.phoneUpdates.length + contactsPlan.phoneOverrides.length) {
      onStep('Refreshing phones from Contacts…')
      await applyContactsImport(contactsPlan)
      contactsAdded = contactsPlan.inserts.length
      phonesUpdated = contactsPlan.phoneUpdates.length
    }
  }
  onStep('Matching names…')
  const [clients, aliases] = await Promise.all([fetchAllClients(), fetchAllAliases()])
  const dates = input.days.map((d) => d.date)
  const [confirmed, stored] = await Promise.all([fetchConfirmedDates(dates), fetchStoredBookings(dates)])
  const plan = planScheduleImport(input.days, createNameMatcher(clients, aliases), confirmed, stored)
  onStep('Saving…')
  await applyScheduleImport(plan, input.source, input.details)
  return { plan, contactsAdded, phonesUpdated }
}
