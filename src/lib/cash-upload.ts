// One cash statement upload path, used by More → Upload cash statement and by
// the daily review. The file is decrypted and parsed on the device; only the
// rows reach the database.

import { fetchAllClients, fetchInsurers } from './api'
import { applyCashImport, fetchPackageKeys, fetchStoredCash } from './cash-api'
import { planCashImport, proposalStartDate, type CashImportPlan } from './cash-import'
import { SETTING } from './defaults'
import { todayISO } from './format'
import { createNameMatcher } from './names'
import { fetchAllAliases, fetchSettings, saveSetting } from './schedule-api'

export class PasswordNeeded extends Error {
  readonly wrong: boolean
  constructor(wrong: boolean) {
    super(wrong ? 'The saved password no longer opens this file.' : 'This file is password-protected.')
    this.wrong = wrong
  }
}

export type PreparedCash = { fileName: string; plan: CashImportPlan; fixedDates: string[]; rows: number }

/** The saved password: her account settings, or an older copy kept in this browser. */
async function savedPassword(): Promise<string> {
  const fromAccount = (await fetchSettings())[SETTING.cashPassword] as string | undefined
  if (fromAccount) return fromAccount
  try {
    return localStorage.getItem('clinic-admin.cash-password') ?? ''
  } catch {
    return ''
  }
}

/**
 * Reads the file and works out what would change. Uses the saved password
 * unless one is given; throws PasswordNeeded when it can't open the file.
 */
export async function prepareCashUpload(
  file: { name: string; bytes: Uint8Array },
  typedPassword: string | null,
  onStep: (label: string) => void = () => {},
): Promise<PreparedCash> {
  const [{ read }, crypto, { parseCashStatement }] = await Promise.all([
    import('xlsx'),
    import('./office-crypto'),
    import('./cash-statement'),
  ])
  let bytes = file.bytes
  if (crypto.isEncryptedOfficeFile(bytes)) {
    const password = typedPassword ?? (await savedPassword())
    if (!password) throw new PasswordNeeded(false)
    onStep('Unlocking the file (a few seconds)…')
    try {
      bytes = await crypto.decryptOfficeFile(bytes, password)
    } catch (err) {
      if (err instanceof crypto.WrongPasswordError) throw new PasswordNeeded(true)
      throw err
    }
    // Remember it in her account, so she never has to type it again.
    await saveSetting(SETTING.cashPassword, password)
    try {
      localStorage.removeItem('clinic-admin.cash-password')
    } catch {
      // nothing stored
    }
  }
  onStep('Reading the transactions…')
  const insurers = [...(await fetchInsurers()), 'nextcare']
  const parsed = parseCashStatement(read(bytes, { type: 'array', cellDates: true }), { insurers })
  if (!parsed.rows.length) throw new Error('No transactions found. Is this the cash statement?')
  const [clients, aliases, stored, packages] = await Promise.all([fetchAllClients(), fetchAllAliases(), fetchStoredCash(), fetchPackageKeys()])
  const names = new Map(clients.map((c) => [c.id, c.name]))
  const plan = planCashImport(
    parsed.rows,
    stored,
    createNameMatcher(clients, aliases),
    (id) => names.get(id) ?? id,
    packages,
    proposalStartDate(stored.map((s) => s.date), todayISO()),
  )
  return { fileName: file.name, plan, fixedDates: parsed.fixedDates, rows: parsed.rows.length }
}

export const saveCashUpload = (p: PreparedCash) => applyCashImport(p.plan, p.fileName, p.fixedDates)

/** "12 new rows, 1 updated, 2 packages to review". */
export function cashSummary(plan: CashImportPlan): string {
  const parts = [
    `${plan.inserts.length} new row${plan.inserts.length === 1 ? '' : 's'}`,
    plan.changes.length ? `${plan.changes.length} updated` : '',
    plan.missing.length ? `${plan.missing.length} no longer in the file (kept, flagged)` : '',
    plan.packageProposals.length ? `${plan.packageProposals.length} new package${plan.packageProposals.length === 1 ? '' : 's'} to review on Today` : '',
  ].filter(Boolean)
  return plan.inserts.length + plan.changes.length + plan.missing.length ? parts.join(', ') : 'Already up to date'
}
