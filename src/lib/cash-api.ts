// Stores an uploaded cash statement: only parsed rows reach the database; the
// file itself never leaves the device.

import type { CashImportPlan, StoredCash } from './cash-import'
import type { Json } from './database.types'
import { supabase } from './supabase'

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new Error(error.message)
}

export async function fetchStoredCash(): Promise<StoredCash[]> {
  const all: StoredCash[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('cash_transactions')
      .select('id, date, source_key, name_raw, description, debit, credit, method, pos_amount, kind, missing_from_source, balance')
      .order('id')
      .range(from, from + 999)
    fail(error)
    all.push(...data)
    if (data.length < 1000) return all
  }
}

export async function fetchPackageKeys() {
  const { data, error } = await supabase.from('packages').select('client_id, purchased_on, sessions_total')
  fail(error)
  return data
}

export async function applyCashImport(plan: CashImportPlan, fileName: string, fixedDates: string[]) {
  const { data: imp, error: impError } = await supabase
    .from('imports')
    .insert({
      kind: 'cash',
      filename: fileName,
      rows_added: plan.inserts.length,
      rows_changed: plan.changes.length,
      details: {
        changed: plan.changes.map((c) => ({ key: c.row.sourceKey, fields: c.fields })),
        missing: plan.missing.length,
        packages_proposed: plan.packageProposals.length,
        fixed_dates: fixedDates,
      } as unknown as Json,
    })
    .select('id')
    .single()
  fail(impError)

  for (let i = 0; i < plan.inserts.length; i += 500) {
    const { error } = await supabase
      .from('cash_transactions')
      .insert(plan.inserts.slice(i, i + 500).map((r) => ({ ...r, import_id: imp.id })))
    fail(error)
  }
  for (const c of plan.changes) {
    const { error } = await supabase
      .from('cash_transactions')
      .update({ ...c.values, import_id: imp.id, missing_from_source: false })
      .eq('id', c.id)
    fail(error)
  }
  // Running balances, a few at a time.
  for (let i = 0; i < plan.balances.length; i += 20) {
    const results = await Promise.all(
      plan.balances.slice(i, i + 20).map((b) => supabase.from('cash_transactions').update({ balance: b.balance }).eq('id', b.id)),
    )
    for (const r of results) fail(r.error)
  }
  for (const [ids, missing] of [
    [plan.missing, true],
    [plan.returned, false],
  ] as const) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase.from('cash_transactions').update({ missing_from_source: missing }).in('id', ids.slice(i, i + 200))
      fail(error)
    }
  }
  if (plan.packageProposals.length) {
    const { error } = await supabase.from('packages').insert(
      plan.packageProposals.map((p) => ({
        client_id: p.clientId,
        sessions_total: p.sessions,
        price_total: p.price,
        per_session: Math.round(p.price / p.sessions),
        purchased_on: p.date,
        source_voucher: p.voucher,
        amount_paid: p.price,
        status: 'proposed',
        notes: p.note,
      })),
    )
    fail(error)
  }
}
