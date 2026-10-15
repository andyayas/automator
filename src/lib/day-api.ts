// Daily review: what the draft is built from, confirming a day (the only place
// sessions are deducted), and the report files in private Storage.

import type { Tables } from './database.types'
import type { DayRow, ExpenseLine } from './day-builder'
import { supabase } from './supabase'

export type DaySessionRow = Tables<'day_sessions'>
export type DayReview = Tables<'day_reviews'>
export type CashRowForDay = Pick<
  Tables<'cash_transactions'>,
  'id' | 'name_raw' | 'description' | 'debit' | 'credit' | 'method' | 'pos_amount' | 'kind' | 'client_id'
>

const BUCKET = 'private'
const TEMPLATE_FILE = 'templates/daily-report.xlsx'

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new Error(error.message)
}

async function userFolder(): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new Error('Not signed in.')
  return data.user.id
}

export async function fetchCashForDay(date: string): Promise<CashRowForDay[]> {
  const { data, error } = await supabase
    .from('cash_transactions')
    .select('id, name_raw, description, debit, credit, method, pos_amount, kind, client_id')
    .eq('date', date)
    .eq('missing_from_source', false)
  fail(error)
  return data
}

export async function fetchLatestCashDate(): Promise<string | null> {
  const { data, error } = await supabase.from('cash_transactions').select('date').order('date', { ascending: false }).limit(1)
  fail(error)
  return data[0]?.date ?? null
}

export async function fetchExpenseLabels(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('expense_labels').select('match_key, label')
  fail(error)
  return new Map(data.map((e) => [e.match_key, e.label]))
}

export async function fetchDayReview(date: string): Promise<{ review: DayReview | null; sessions: DaySessionRow[] }> {
  const [review, sessions] = await Promise.all([
    supabase.from('day_reviews').select('*').eq('date', date).maybeSingle(),
    supabase.from('day_sessions').select('*').eq('date', date).order('created_at'),
  ])
  fail(review.error)
  fail(sessions.error)
  return { review: review.data, sessions: sessions.data }
}

export async function fetchRecentReviews(dates: string[]): Promise<DayReview[]> {
  const { data, error } = await supabase.from('day_reviews').select('*').in('date', dates)
  fail(error)
  return data
}

/**
 * Confirms the day: replaces its sessions with the reviewed rows (confirmed),
 * which is what deducts them from packages and approvals, and learns any
 * expense labels she corrected.
 */
export async function confirmDay(date: string, rows: DayRow[], expenses: ExpenseLine[], editedLabels: Map<string, string>) {
  const { error: delError } = await supabase.from('day_sessions').delete().eq('date', date)
  fail(delError)
  if (rows.length) {
    const { error } = await supabase.from('day_sessions').insert(
      rows.map((r) => ({
        date,
        client_id: r.clientId,
        client_name: r.clientName,
        therapist: r.therapist,
        billing_type: r.billingType,
        payment_method: r.paymentMethod,
        package_id: r.billingType === 'package' ? r.packageId : null,
        approval_id: r.billingType === 'insurance' ? r.approvalId : null,
        schedule_entry_id: r.scheduleEntryId,
        cash_transaction_id: r.cashIds[0] ?? null,
        session_no: r.sessionNo,
        billed: r.billed,
        collected: r.collected,
        extra_note: r.extraNote || null,
        confirmed: true,
      })),
    )
    fail(error)
  }
  const { error: reviewError } = await supabase
    .from('day_reviews')
    .upsert({ date, confirmed_at: new Date().toISOString() }, { onConflict: 'owner_id,date' })
  fail(reviewError)

  const learned = expenses.filter((e) => editedLabels.has(e.cashId)).map((e) => ({ match_key: e.matchKey, label: editedLabels.get(e.cashId)! }))
  if (learned.length) {
    const { error } = await supabase.from('expense_labels').upsert(learned, { onConflict: 'owner_id,match_key' })
    fail(error)
  }
}

/** Undoes a confirmation: the day's sessions stop counting until confirmed again. */
export async function reopenDay(date: string) {
  const { error } = await supabase.from('day_sessions').delete().eq('date', date)
  fail(error)
  const { error: rError } = await supabase.from('day_reviews').update({ confirmed_at: null }).eq('date', date)
  fail(rError)
}

// ---------------------------------------------------------------------------
// Files (private bucket, her folder only)
// ---------------------------------------------------------------------------

export async function uploadTemplate(file: File) {
  const folder = await userFolder()
  const { error } = await supabase.storage.from(BUCKET).upload(`${folder}/${TEMPLATE_FILE}`, file, {
    upsert: true,
    contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  fail(error)
}

export async function templateInfo(): Promise<{ updatedAt: string | null } | null> {
  const folder = await userFolder()
  const { data, error } = await supabase.storage.from(BUCKET).list(`${folder}/templates`)
  fail(error)
  const file = data.find((f) => f.name === 'daily-report.xlsx')
  return file ? { updatedAt: file.updated_at ?? file.created_at ?? null } : null
}

export async function downloadTemplate(): Promise<ArrayBuffer> {
  const folder = await userFolder()
  const { data, error } = await supabase.storage.from(BUCKET).download(`${folder}/${TEMPLATE_FILE}`)
  if (error || !data) throw new Error('No report template yet. Upload it in Settings first.')
  return data.arrayBuffer()
}

export async function saveReport(date: string, bytes: Uint8Array) {
  const folder = await userFolder()
  const path = `${folder}/reports/${date}.xlsx`
  const { error } = await supabase.storage.from(BUCKET).upload(path, new Blob([bytes as BlobPart]), {
    upsert: true,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  fail(error)
  const { error: rError } = await supabase
    .from('day_reviews')
    .update({ report_storage_path: path, report_generated_at: new Date().toISOString() })
    .eq('date', date)
  fail(rError)
}

/** Triggers a browser download of the bytes. */
export function downloadFile(bytes: Uint8Array, fileName: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Links cash statement rows written under this name (and not linked yet) to the
 * client, so payments by a spelling the app didn't know count for that client.
 */
export async function linkCashName(nameKey: string, clientId: string, normalize: (s: string) => string) {
  const { data, error } = await supabase
    .from('cash_transactions')
    .select('id, name_raw')
    .is('client_id', null)
    .in('kind', ['session', 'package', 'insurance_copay', 'other'])
  fail(error)
  const ids = data.filter((c) => normalize(c.name_raw ?? '') === nameKey).map((c) => c.id)
  for (let i = 0; i < ids.length; i += 200) {
    const { error: uError } = await supabase.from('cash_transactions').update({ client_id: clientId }).in('id', ids.slice(i, i + 200))
    fail(uError)
  }
}

export async function downloadSavedReport(path: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error || !data) throw new Error('The saved report could not be found.')
  return new Uint8Array(await data.arrayBuffer())
}
