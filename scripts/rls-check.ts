// Proves that one account cannot see or touch another account's rows or files.
// Local only, never deployed:  npm run check:rls
//
// Needs in .env.local: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and two test
// logins RLS_TEST_A_* / RLS_TEST_B_*. User B owns the fixtures; user A and an
// anonymous client try to read, change and delete them. Credentials are never
// printed. Fixtures are dated 2000-01-01 or tagged, and removed at the end.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function env(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing ${name} in .env.local`)
    process.exit(2)
  }
  return value
}

const url = env('VITE_SUPABASE_URL')
const anonKey = env('VITE_SUPABASE_ANON_KEY')
const newClient = () =>
  createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })

type Row = Record<string, unknown>
type Ids = Record<string, string>

const TAG = `rls-check-${Date.now()}`
const DAY = '2000-01-01'
const BUCKET = 'private'

// Views must run with the caller's RLS; each is checked against B's fixture rows.
const VIEWS: Array<{ view: string; idOf: string }> = [
  { view: 'package_balances', idOf: 'packages' },
  { view: 'approval_balances', idOf: 'insurance_approvals' },
]

// One fixture per table, in dependency order. A table in the database that is
// missing here makes the check fail, so new tables can't skip the test.
const FIXTURES: Array<{ table: string; row: (ids: Ids) => Row }> = [
  { table: 'clients', row: () => ({ name: `${TAG} client` }) },
  { table: 'client_aliases', row: (ids) => ({ client_id: ids.clients, alias: `${TAG} alias` }) },
  {
    table: 'packages',
    row: (ids) => ({ client_id: ids.clients, sessions_total: 12, price_total: 450, per_session: 38 }),
  },
  {
    table: 'insurance_approvals',
    row: (ids) => ({
      client_id: ids.clients,
      insurer: 'test insurer',
      sessions_approved: 10,
      billed_per_session: 25,
    }),
  },
  { table: 'imports', row: () => ({ kind: 'cash', filename: `${TAG}.xlsx` }) },
  {
    table: 'cash_transactions',
    row: (ids) => ({
      date: DAY,
      voucher: 'rc1',
      source_key: `${TAG}|rc1`,
      debit: 45,
      client_id: ids.clients,
      import_id: ids.imports,
    }),
  },
  {
    table: 'schedule_entries',
    row: (ids) => ({
      date: DAY,
      slot_time: '07:00',
      therapist: 'Test Therapist',
      raw_text: 'Test Client C',
      client_id: ids.clients,
      import_id: ids.imports,
    }),
  },
  {
    table: 'day_sessions',
    row: (ids) => ({
      date: DAY,
      client_id: ids.clients,
      billing_type: 'package',
      package_id: ids.packages,
      schedule_entry_id: ids.schedule_entries,
      cash_transaction_id: ids.cash_transactions,
    }),
  },
  { table: 'day_reviews', row: () => ({ date: DAY }) },
  { table: 'reminders', row: (ids) => ({ date: DAY, slot_time: '07:00', client_id: ids.clients }) },
  { table: 'settings', row: () => ({ key: 'rls_check', value: { tag: TAG } }) },
  { table: 'non_client_patterns', row: () => ({ pattern: TAG, match_type: 'exact' }) },
  { table: 'expense_labels', row: () => ({ match_key: `${TAG}|test`, label: 'Test' }) },
]

let failures = 0
function check(ok: boolean, label: string, detail?: string) {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  (${detail})` : ''}`)
}

async function signIn(who: 'A' | 'B'): Promise<{ db: SupabaseClient; userId: string }> {
  const db = newClient()
  const { data, error } = await db.auth.signInWithPassword({
    email: env(`RLS_TEST_${who}_EMAIL`),
    password: env(`RLS_TEST_${who}_PASSWORD`),
  })
  if (error || !data.user) {
    console.error(`Could not sign in test user ${who}: ${error?.message ?? 'no user'}`)
    process.exit(2)
  }
  return { db, userId: data.user.id }
}

async function main() {
  const anon = newClient()
  const a = await signIn('A')
  const b = await signIn('B')
  if (a.userId === b.userId) {
    console.error('RLS_TEST_A and RLS_TEST_B are the same account. Use two different users.')
    process.exit(2)
  }

  // Leftovers from an interrupted run would collide on these unique keys.
  await b.db.from('day_reviews').delete().eq('date', DAY)
  await b.db.from('settings').delete().eq('key', 'rls_check')

  const ids: Ids = {}
  const created: string[] = []
  const storagePath = `${b.userId}/rls-check/${TAG}.txt`

  try {
    // --- Every table in the database is covered and locked down -------------
    const report = await a.db.rpc('table_security_report')
    check(!report.error, 'security report readable by a signed-in user', report.error?.message)
    const relations = (report.data ?? []) as Array<{
      table_name: string
      kind: 'table' | 'view'
      rls_enabled: boolean
      policy_count: number
      has_owner_id: boolean
      security_invoker: boolean
      anon_has_access: boolean
    }>
    const tables = relations.filter((r) => r.kind === 'table')
    const covered = new Set(FIXTURES.map((f) => f.table))
    for (const t of tables) {
      check(covered.has(t.table_name), `${t.table_name}: has a fixture in rls-check.ts`)
      check(
        t.rls_enabled && t.policy_count > 0 && t.has_owner_id && !t.anon_has_access,
        `${t.table_name}: RLS on, policies present, owner_id column, no anon privileges`,
        JSON.stringify(t),
      )
    }
    for (const v of relations.filter((r) => r.kind === 'view')) {
      check(VIEWS.some((x) => x.view === v.table_name), `${v.table_name}: view is covered in rls-check.ts`)
      check(
        v.security_invoker && v.has_owner_id && !v.anon_has_access,
        `${v.table_name}: view uses security_invoker, has owner_id, no anon privileges`,
        JSON.stringify(v),
      )
    }
    for (const f of FIXTURES) {
      check(tables.some((t) => t.table_name === f.table), `${f.table}: exists in the database`)
    }
    const anonReport = await anon.rpc('table_security_report')
    check(!!anonReport.error, 'security report hidden from anonymous visitors')

    // --- User B creates one row in every table -------------------------------
    for (const f of FIXTURES) {
      const { data, error } = await b.db.from(f.table).insert(f.row(ids)).select('id').single()
      if (error || !data) throw new Error(`${f.table}: owner could not insert: ${error?.message}`)
      ids[f.table] = data.id as string
      created.push(f.table)
    }
    check(true, 'owner can insert into every table')

    // --- User A and anonymous try to reach B's rows --------------------------
    for (const f of FIXTURES) {
      const id = ids[f.table]

      const sel = await a.db.from(f.table).select('id').eq('id', id)
      check(!sel.error && sel.data?.length === 0, `${f.table}: other user cannot read`, sel.error?.message)

      const upd = await a.db
        .from(f.table)
        .update({ updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('id')
      check(!upd.error && upd.data?.length === 0, `${f.table}: other user cannot update`, upd.error?.message)

      const del = await a.db.from(f.table).delete().eq('id', id).select('id')
      check(!del.error && del.data?.length === 0, `${f.table}: other user cannot delete`, del.error?.message)

      const still = await b.db.from(f.table).select('id').eq('id', id)
      check(still.data?.length === 1, `${f.table}: owner's row is untouched`)

      const spoof = await a.db.from(f.table).insert({ ...f.row(ids), owner_id: b.userId })
      check(spoof.error?.code === '42501', `${f.table}: other user cannot insert rows as the owner`, spoof.error?.code)

      const anonSel = await anon.from(f.table).select('id').eq('id', id)
      check(!!anonSel.error || anonSel.data?.length === 0, `${f.table}: anonymous cannot read`)

      const anonIns = await anon.from(f.table).insert(f.row(ids))
      check(anonIns.error?.code === '42501', `${f.table}: anonymous cannot insert`, anonIns.error?.code)
    }

    // --- Views apply the caller's RLS -----------------------------------------
    for (const { view, idOf } of VIEWS) {
      const own = await b.db.from(view).select('id').eq('id', ids[idOf])
      check(own.data?.length === 1, `${view}: owner sees own balance`, own.error?.message)
      const other = await a.db.from(view).select('id').eq('id', ids[idOf])
      check(!other.error && other.data?.length === 0, `${view}: other user cannot read`, other.error?.message)
      const anonView = await anon.from(view).select('id').eq('id', ids[idOf])
      check(!!anonView.error || anonView.data?.length === 0, `${view}: anonymous cannot read`)
    }
    const balance = await b.db.from('package_balances').select('sessions_remaining').eq('id', ids.packages).single()
    check(balance.data?.sessions_remaining === 12, 'unconfirmed day sessions do not deduct', JSON.stringify(balance.data))

    // --- A cannot link its own rows to B's rows ------------------------------
    const own = await a.db.from('clients').insert({ name: `${TAG} A client` }).select('id').single()
    check(!own.error, 'other user can create its own client', own.error?.message)
    const crossPkg = await a.db
      .from('packages')
      .insert({ client_id: ids.clients, sessions_total: 1, price_total: 1, per_session: 1 })
    check(crossPkg.error?.code === '23503', "other user cannot attach a package to the owner's client", crossPkg.error?.code)
    const crossAlias = await a.db.from('client_aliases').insert({ client_id: ids.clients, alias: `${TAG} x` })
    check(crossAlias.error?.code === '23503', "other user cannot add an alias to the owner's client", crossAlias.error?.code)
    if (own.data) await a.db.from('clients').delete().eq('id', own.data.id)

    // --- Storage: private bucket, owner's folder only ------------------------
    const up = await b.db.storage.from(BUCKET).upload(storagePath, new Blob(['rls check']), {
      contentType: 'text/plain',
    })
    check(!up.error, 'owner can upload to own folder', up.error?.message)

    const aDown = await a.db.storage.from(BUCKET).download(storagePath)
    check(!!aDown.error, "other user cannot download the owner's file")
    const aList = await a.db.storage.from(BUCKET).list(`${b.userId}/rls-check`)
    check(!aList.error && aList.data?.length === 0, "other user cannot list the owner's folder")
    const aUp = await a.db.storage
      .from(BUCKET)
      .upload(`${b.userId}/rls-check/${TAG}-a.txt`, new Blob(['x']), { contentType: 'text/plain' })
    check(!!aUp.error, "other user cannot upload into the owner's folder")
    await a.db.storage.from(BUCKET).remove([storagePath])
    const bDown = await b.db.storage.from(BUCKET).download(storagePath)
    check(!bDown.error, "other user cannot delete the owner's file")
    const rootUp = await a.db.storage.from(BUCKET).upload(`${TAG}.txt`, new Blob(['x']), {
      contentType: 'text/plain',
    })
    check(!!rootUp.error, 'nobody can upload outside their own folder')
    const anonDown = await anon.storage.from(BUCKET).download(storagePath)
    check(!!anonDown.error, 'anonymous cannot download files')
    const pub = await anon.storage.from(BUCKET).list()
    check(!pub.error && pub.data?.length === 0, 'anonymous cannot list the bucket')

    // Google refresh tokens: only the google-token Edge Function (service role) reaches them.
    for (const [who, db] of [['a signed-in user', b.db], ['anonymous', anon]] as const) {
      const get = await db.rpc('google_connection_get', { p_owner: b.userId })
      check(Boolean(get.error), `${who} cannot read Google tokens`)
      const save = await db.rpc('google_connection_save', { p_owner: b.userId, p_email: null, p_refresh_token: TAG, p_scope: TAG })
      check(Boolean(save.error), `${who} cannot write Google tokens`)
      const del = await db.rpc('google_connection_delete', { p_owner: b.userId })
      check(Boolean(del.error), `${who} cannot delete Google tokens`)
      const table = await db.schema('private').from('google_connections').select('*')
      check(Boolean(table.error), `${who} cannot reach the private schema`)
    }
    const status = await anon.rpc('google_connection_status')
    check(Boolean(status.error), 'anonymous cannot ask for Google connection status')
  } finally {
    await b.db.storage.from(BUCKET).remove([storagePath])
    for (const table of created.reverse()) {
      const { error } = await b.db.from(table).delete().eq('id', ids[table])
      if (error) console.warn(`cleanup: could not delete ${table} fixture: ${error.message}`)
    }
  }

  console.log(failures === 0 ? '\nAll RLS checks passed.' : `\n${failures} RLS check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
