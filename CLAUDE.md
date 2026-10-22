# Clinic Admin Assistant

A personal tool for **one person**: the administrator of a small physiotherapy
clinic. It automates her daily report, tracks client packages and insurance
approvals, shows the schedule with that context, and sends WhatsApp appointment
reminders. It is not a clinic system: nobody else logs in, and the clinic's own
files and workflow stay exactly as they are.

This repo is **public** (GitHub Pages). Read the Security section before writing
anything.

## Project facts

- **Repo**: `andyayas/automator` (public), at https://github.com/andyayas/automator.
  It was created empty on GitHub. The local folder may not be a git repo yet.
- **Live URL**: https://andyayas.github.io/automator/, so Vite `base` is
  `/automator/`.
- **Supabase project**: ref `ljwscptbrwpibbbfgdpk`, URL
  `https://ljwscptbrwpibbbfgdpk.supabase.co`. The URL and anon key are in
  `.env.local`. For the deploy workflow they go in GitHub Actions repository
  variables named `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Both are
  public values, so variables are fine.
- **Real sample files** are in `samples/`, which is gitignored:
  - `September 2026.xlsx`
  - `Cash Statement 2026.xlsx`
  - `Daily Report September 2026.xlsx`
  - `Daily Report Template.xlsx`

## Working agreement (for Claude Code)

- **Do everything you can yourself** from the terminal: git init, remote and
  push; scaffolding and installs; Supabase CLI migrations; GitHub settings via
  the `gh` CLI (Pages source, Actions variables).
- **Stop when a step truly needs the user**, give exact numbered instructions,
  and wait. That means logins (`gh auth login`, `supabase login`), the database
  password for `supabase link`, Supabase dashboard toggles, creating accounts,
  or anything in a browser. Batch these so he isn't interrupted constantly.
- **Plan before each phase** and wait for approval before writing code.
- **Before every commit**, run `git status` and confirm nothing from
  `samples/`, no `.xlsx`/`.csv`, and no `.env*` file other than `.env.example`
  is staged.
- **Never** put the `service_role` key or the database password in the repo,
  the frontend, a commit, or a log. Never echo the cash statement password.
- Keep the checklist below up to date as items get done.

### Commands

- `npm run dev` / `npm test` / `npm run lint` / `npm run build`
- `supabase db push --linked` applies migrations (no DB password needed).
- `npm run check:rls` must pass after every schema change. It fails if a
  table has no fixture in `scripts/rls-check.ts`, so add one for each new
  table. New migrations that add tables end with the assertion block from
  the latest migration that has one (the views-aware version, e.g.
  `20261016100000_google_connection.sql`).
- The pre-commit hook (`.githooks/`, enabled by `npm install`) and CI both
  refuse `samples/`, spreadsheets and `.env*` files.
- The pre-commit hook also runs `scripts/scan-real-names.ts` when `samples/`
  exists: it blocks any staged line containing a real client name (from
  Contacts, the schedule or the old reports). `npm run check:names` scans every
  tracked file. Don't rely on ad-hoc scans chained after `&&`.
- CI runs tests without Supabase env. Unit tests must not import
  `src/lib/supabase.ts` (directly or via `api.ts`) unless they mock it. Check
  locally with `VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npm test`.
- `npm run test:integration` runs the data layer against the live project as
  RLS test user A (synthetic rows, cleaned up).
- `npm run gen:types` regenerates `src/lib/database.types.ts` after migrations.
- `npm run compare:reports` rebuilds each day her old reports cover and
  compares clients, collected amounts and billing (details in
  `samples/report-comparison.md`).
- `npm run seed` (dry run) / `npm run seed -- --apply` is the go-live seed. It
  writes `samples/seed-report.md` (real names, gitignored) and prints counts only.
  People in her statement, the daily reports or recent package payments who
  match no client are created as new clients **without a phone** (Contacts is an
  old export of the clinic phone and misses many clients). Near-misses are never
  merged into an existing client automatically.

### Manual setup checklist

- [x] Supabase: turn off "Allow new users to sign up" (Authentication → Sign In
      / Providers). Verified: `/auth/v1/signup` returns `signup_disabled`.
      `supabase/config.toml` also has `enable_signup = false` so a
      `config push` can't re-enable it.
- [x] Supabase: create the admin's user (Authentication → Users → Add user).
- [x] Supabase: two RLS test users; their logins are `RLS_TEST_*` in
      `.env.local` (never `VITE_`).
- [x] Supabase region: `eu-central-1` (Frankfurt).
- [x] Supabase CLI linked to `ljwscptbrwpibbbfgdpk` (no DB password needed;
      the CLI uses a temporary login role).
- [x] GitHub Pages source = GitHub Actions (set via `gh api`).
- [x] GitHub Actions variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
      (set via `gh variable set`).
- [x] Google Cloud project "Clinic Admin": Sheets API enabled, OAuth client
      (Web) with origins `https://andyayas.github.io` and
      `http://localhost:5173`, scope `spreadsheets.readonly`, Testing mode.
      Client ID in `.env.local` and the `VITE_GOOGLE_CLIENT_ID` repo variable.
- [x] Google Auth Platform → Audience → Test users: the account(s) that open
      the clinic sheet.
- [x] Google client secret stored as Supabase function secrets
      (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).
- [x] Google Auth Platform → Branding (home page, `privacy.html`, authorized
      domain `andyayas.github.io`), then Audience → **Publish app**: In
      production since 2026-10-16. In Testing mode Google expires refresh tokens
      after 7 days. Unverified is fine for one user: she taps Advanced → Go to
      Clinic Admin once.
- [ ] She connects Google once with the clinic account (Settings → Google
      connection).
- [ ] Google Cloud → APIs & Services: enable the **Google Drive API** (used to
      share new month sheets). Google Auth Platform → Data access: add the
      `.../auth/drive.file` scope.
- [x] Settings in the app: sender name, and the October sheet link
      (add each new month's link when the new sheet starts).
- [x] Go-live (2026-10-15): Contacts imported, `npm run seed -- --apply` run.
- [ ] She reviews the proposed packages on Today and enters insurance
      approvals by hand (seed report lists the insurance clients).

## Principles

1. **Each fact is entered once, where other people already look for it.**
   Physiotherapists keep booking in the clinic's Google Sheet and logging money in
   the cash statement Excel file. The admin keeps doing the same. This app
   **reads** those sources and never asks her to retype what is already in them.
2. **The app only stores what exists nowhere else**: package purchases, insurance
   approvals, name aliases, phone fixes, reminder send log, and her
   confirmations of each day.
3. **Read-only toward clinic files.** Never write to, re-share, publish or
   restructure the Google Sheet or the cash statement. One exception, by the
   owner's decision (2026-10-16): the app may **create** each new month's
   schedule sheet (Google `drive.file` scope, which reaches only files the app
   created) and share it with the emails in Settings. It still never edits an
   existing sheet.
4. **Propose, then confirm.** The schedule is not always the truth (people on it
   sometimes don't come; people pay without being on it). The app drafts each day
   and flags doubts. Sessions are deducted from packages and approvals only after
   she confirms the day. Never deduct silently.
5. **Mobile first.** She'll use it on a laptop and on two phones, both always
   with her: her own and the clinic phone (which has the clinic WhatsApp, used
   for reminders). Normal persistent login on all of them.

## Stack

- **Frontend**: Vite + React + TypeScript, deployed to GitHub Pages via GitHub
  Actions. Use a hash router (GitHub Pages has no SPA fallback). Vite `base` is
  `/automator/`.
- **Backend**: Supabase (Postgres + Auth + Storage), Frankfurt region.
- **Reading Excel**: SheetJS. Install from `https://cdn.sheetjs.com` (the npm
  registry copy is outdated).
- **Decrypting the cash statement**: in the browser, see "Cash statement
  decryption" below. Use the `cfb` package plus Web Crypto.
- **Writing the daily report**: ExcelJS, loading the blank template and filling
  values so the styling survives.
- **Google Sheet live read (phase 3b)**: Google Identity Services token client
  with scope `spreadsheets.readonly`, calling the Sheets API from the browser.
  She connects **once** (Settings → Google connection, or "Connect Google
  Sheet"): Google's popup code flow (`initCodeClient`, offline access) gives a
  one-time code; the `google-token` Edge Function swaps it for a refresh token
  kept in `private.google_connections` (outside the API schemas, reachable only
  by the function's service role through `google_connection_*` functions).
  Any of her devices then gets one-hour access tokens from the function with
  no popup; Schedule, Reminders and the daily review re-read the sheet by
  themselves (on opening, on returning to the app, every 5 minutes). Function
  secrets `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are set with
  `supabase secrets set`, never in the repo. Deploy it with
  `supabase functions deploy google-token --project-ref ljwscptbrwpibbbfgdpk --use-api`.
  It connects with the clinic Google account (the one the sheet is shared with).
- **Next month's sheet** (`src/lib/month-sheet.ts`, `createMonthSheet` in
  `google-sheets.ts`): **More → New month sheet** (`/more/create-sheet`) picks
  any month and creates its sheet; Today shows "<Month>'s sheet isn't created
  yet" from the 25th, linking there. The share list lives on that page. It builds one tab per Mon–Sat ("Mon 2 NOV") in the clinic's
  design, kept in the code (`DESIGN`, from the October 2026 export, C/E/G
  removed, therapist columns wider); the therapist names in row 3 come from
  the app's last two weeks of schedule (staff names never go in the repo).
  It saves the link for that month and shares the sheet (edit, Google's
  email) with `settings.sheet_share_with`. Needs the `drive.file` scope:
  connections made before it get one more Google consent on the first create.

## Security (non-negotiable)

- **No real data in the repo, ever.** Real sample files live in `samples/`, which
  is gitignored. Test fixtures that must be committed are synthetic, with invented
  names. Don't paste real client names into code, comments, tests, commit messages
  or this file.
- **Report template:** the blank template (labels, clinic name, logo) is built
  into the app at `src/assets/daily-report-template.xlsx`, by the owner's
  decision on 2026-10-15, so it is public. It's the only spreadsheet the
  leak guard allows. An uploaded template (Settings) in the private bucket
  takes priority. Nothing else clinic-identifying goes in the repo.
- **The Supabase anon / publishable key is public by design.** Row-level security is what
  protects data. Every table gets RLS enabled, with an `owner_id uuid default
  auth.uid()` column and policies `using (owner_id = auth.uid())` /
  `with check (owner_id = auth.uid())`. No table without RLS. Public sign-ups are
  disabled in the Supabase dashboard, so she is the only user.
- **The cash statement password is never stored in code or in the bundle.** It is
  kept in her private `settings` row `cash_password` (RLS, her account only), so
  uploads unlock by themselves on every device. The go-live seed writes it; if
  it ever stops working she types the new one once and it is saved again. Vite
  inlines every `VITE_*` env var into the public bundle, so the password must
  never be a `VITE_` variable. For local tests it is `SAMPLE_CASH_PASSWORD` in
  `.env.local`, read only by test code.
- **The cash statement file never leaves the device.** Decrypt and parse in the
  browser, then send only the parsed transaction rows to Supabase.
- ~~"Export all data" button~~: not needed (owner's decision, 2026-10-15).

## Data sources

### 1. Appointment schedule (Google Sheet, read-only)

Sample: `samples/September 2026.xlsx` (an export of the live sheet).

- One tab per working day, named like `Tue 22 SEP` (`%a %-d %b`, month uppercase).
  Sundays are skipped and some Saturdays too. A new spreadsheet or tab set exists
  per month.
- The date comes from the tab name (`Tue 22 SEP`, no year: the year is the
  sheet title's, else the month of its link in Settings). Older exports also
  have it in `I1`, which is used when present.
- Row 3: therapist names. The reader uses whichever columns from B onward
  have a name there (`therapistColumns` in `src/lib/schedule.ts`), so both
  layouts work.
- Rows 4–33: half-hour slots, `A4` = `7h00 am` … `A33` = `10h00 pm`.
- **Layout change (2026-10-16):** the sheet used to have therapists in
  **B, D, F**, WhatsApp-reminder formulas in **C, E, G** and the date in `I1`.
  He deleted the formula columns and the date cell, so therapists are now side
  by side (**B, C, D**). Old exports (September, early October) still have
  the old layout; both are read the same way.
- Row 34 `Total Hrs of Sessions`; row 36 `Notes`.
- A `Contacts` tab (**removed from the live sheet on 2026-10-16**; older
  exports still have it, and the importer reads it there; phones now come
  from the clinic phone's .vcf export and her fixes): column A name, column B phone (~2,000 real rows, then
  empty ones). Use it as the base client list, for fuzzy matching, and for
  reminder phone numbers. Phones are stored as numbers that may read back as
  floats (`9613001272.0`). Convert them to digit strings with no `+`, as
  `wa.me` expects. Almost all already carry a country code, including ~40
  foreign ones (971, 44, 974…), so only add 961 to short local numbers (7–8
  digits, or 8 with a leading 0). See `src/lib/phone.ts`.
  Contacts is re-read on each schedule import. Phone fixes she makes in the app
  win over Contacts. Contacts is **incomplete**: about a third of the distinct
  names on the schedule aren't in it under any close spelling, so unmatched
  names are normal and get fixed once via an alias.
- The old C/E/G formula columns (`REGEXEXTRACT` + exact `VLOOKUP` against
  Contacts) failed whenever a cell had a status letter, a session number, two
  names or a spelling variant. They were removed on 2026-10-16; the app's
  reminders replace them.

**Cell grammar** (free text, typed by several people, inconsistent):

| Example | Meaning |
|---|---|
| `Firstname Lastname C` | confirmed |
| `Firstname Lastname 11 C` / `C 11` / `C11` / `11C` | session 11 of a package/approval, confirmed |
| `Firstname Lastname X` | cancelled |
| `Firstname Lastname R` | rescheduled |
| `Firstname Lastname` (no letter) | status unknown → flag it |
| `Firstname Lastname 45$` / `C 45$` | amount noted inline |
| `… Insurance` / `… Free` | billing type noted inline |
| `Name One / Name Two` | two clients in one slot |
| lowercase `c`, missing spaces (`LastnameC`) | normal, handle it |

**Not clients** (match case-insensitively). Exact: `meeting`, `off`, `closed`,
`holiday`, `lunch`, `break`, `x`, `-`, `labneh time`. Contains: `app with`,
`meeting with`, `consultation with`, `outdoor`, `inbody test`, `staff`. Also
staff names, which are stored in a settings table rather than in the repo. Keep
this list in the database and let her add to it from the UI.

### 2. Cash statement (Excel on the clinic PC, uploaded daily)

Sample: `samples/Cash Statement 2026.xlsx`. It is password-protected; the
password comes from `.env.local`.

- One tab per month (`January` … `September` in the sample, and `October` in the
  live file). Re-uploading the whole file must be safe, see "Import rules".
- Row 3 headers. Row 6 holds the brought-forward balance in the balance column.
- **Columns move between tabs**: January–June start one column further right
  (Date in E) than July onwards (Date in D). Find them from the row-3 headers
  (`src/lib/cash-statement.ts`). From row 7, the columns are (July layout):
  - **D** Date, filled on the first row of each day only (carry it down)
  - **E** Name (client, vendor, or insurer)
  - **F** Description
  - **G** Voucher (`rc…` = receipt in, `pv…` = payment out)
  - **H** Debit $ (money in)
  - **I** Credit $ (money out)
  - **J** Running balance formula
- **Voucher numbers are recycled** (receipt books run rc1…rc100 and restart),
  so a voucher is not unique. Rows are keyed by date + voucher, or a content
  key when there is no voucher (`source_key`).
- Repeated header rows (`Description`) and `Total` lines are not transactions.
  A few dates are text (`15-sep-26`).
- Packages are sometimes paid in instalments (`first payment …`, `last payment
  of the package`), by card (`paid by card`), or by Wish Money transfer
  (`… wish`).
- **A–B** are LBP columns. **K–M** contain ad-hoc scratch notes; ignore them.
- **POS payments** have no H/I value. The amount is only in the description
  (`single physio session 45$ POS`, `Package of 12 session POS 450$`). Parse it
  and mark the payment method as POS. POS money never touches the cash balance.
- **Insurers appear as payers.** Example: name `nextcare`, description `payment`,
  a lump sum. These are insurer settlements, not client sessions.
- **Common descriptions**: `single physio session`, `N physio sessions`,
  `Package of N session(s)`, `Insurance difference` (the client's co-pay on an
  insurance session).
- Names are lowercase, have trailing spaces, and vary in spelling. Normalize and
  fuzzy-match.

**Expense label mapping** (seed data). The key is `name|description`, lowercased
and trimmed:

```json
{
  "alfa|phone recharge": "Alfa phone recharge",
  "bartartine|coffee": "Coffee",
  "coco laundry|laundry": "Laundry",
  "cream|cream for the team": "Cream",
  "maliks|ink+stationery": "Maliks Ink+Stationery",
  "ogero|fiber internet": "Fiber",
  "sannine water|5 boxes of water": "Water 5 boxes",
  "sannine water|10 boxes of water": "Water 10 boxes",
  "sclub|rent": "Rent",
  "toters|pantry": "Pantry toters",
  "univest|medical rolls": "Medical Rolls",
  "we for media|social media": "Social media"
}
```

Unknown vendors fall back to the Title Case description. Store mappings in the
database and learn new ones when she edits a label.

#### Cash statement decryption

The file uses ECMA-376 **Agile** encryption: AES-256-CBC, SHA-512,
spinCount 100000, 16-byte salt.

Steps:
1. Read the OLE container with `cfb`. Get the `EncryptionInfo` and
   `EncryptedPackage` streams.
2. Parse the XML in `EncryptionInfo` (it follows an 8-byte header).
3. Using the **password keyEncryptor's** saltValue and spinCount, compute
   H0 = SHA512(salt + UTF-16LE password). Then iterate
   H = SHA512(uint32LE(i) + H) for i = 0 … spinCount−1.
4. Derive the key for each blob as SHA512(H + blockKey), truncated to 32 bytes.
   The block keys (hex) are:
   - `fea7d2763b4b9e79` for verifierHashInput
   - `d7aa0f6d3061344e` for verifierHashValue
   - `146e0be7abacd0d6` for encryptedKeyValue

   Decrypt each with AES-256-CBC, using the keyEncryptor saltValue as the IV.
   The verifier pair tells you whether the password is correct. Decrypting
   encryptedKeyValue (first 32 bytes) gives the package key.
5. Decrypt `EncryptedPackage` with the package key. The first 8 bytes are the
   plaintext size (uint64LE). The rest is decrypted in 4096-byte segments, where
   the IV for segment n is SHA512(**keyData** saltValue + uint32LE(n)), truncated
   to 16 bytes. Trim the output to the plaintext size.

Web Crypto's AES-CBC expects PKCS#7 padding, but these blocks have none. Use a
small pure-JS AES (for example `aes-js`) for the raw CBC blocks, or append a
synthetic padding block. Verify against the sample with `msoffcrypto-tool`
(Python) as the reference implementation. Wrong password must give a clear error.

### 3. Old daily reports (history only)

Sample: `samples/Daily Report September 2026.xlsx`. One tab per day (`Tue Sep 22`).

The layout moves from day to day, so find sections by their labels
(`src/lib/old-daily-report.ts`):
- Client table: header row `Client Name` (row 11), rows below it until the first
  blank row or a `Maintenance Follow-Up` heading. Columns: Client Name,
  Therapist, Info, Amount Paid, Amount Billed, Notes. Info is mostly
  `Insurance`, `Package`, `Cash`, `Free`, or `POS 45$`.
- Some days have a `Maintenance Follow-Up` section below (name + call note).
  It is not part of the day's clients.
- Expenses: `Expense Details` header at `H11`, amounts in `I`.
- Reconciliation: under `Cash Reconciliation` (row 23–27 depending on the day):
  Opening Balance, Collected, Expenses, Closing Balance.

There are also 6 October days (1–7 Oct); she stopped making them after that.

These 23 hand-made days are the **ground truth for testing** the matching logic.
They also seed: which clients are on packages or insurance, their usual billed
rate (package rate is typically about 38, insurance 25), and name aliases.

### 4. New daily report template (output format)

Sample: `samples/Daily Report Template.xlsx`. In production it is stored in the
private Storage bucket. It is a single sheet, `Daily Report`, with the logo
anchored at A1.

| Area | Range | Columns |
|---|---|---|
| Date | `C3` label `Date:`, value goes in `D3` (confirm with her) | |
| Insurance | header `A7:F7`, rows **8–19** (12 rows), total row 20 | Client, Billed, Collected, Session No., Serial Number, Extra Note |
| Package | header row 23, rows **24–31** (8 rows), total row 32 | Client, Billed, Collected, Session No. (`D:E` merged), Extra Note |
| Per Session | header row 35, rows **36–45** (10 rows), total row 46 | Client, Billed, Collected, Extra Note (`D:F` merged) |
| Expenses | `A49:B56` merged label, amounts `C49:C56` (8 lines), total `C57` | |
| Summary | `E48:F54` | Total Clients, Billed, Collected, Insurance Not Paid, Insurance Paid, Package Paid, Package Not Paid |
| Net | `E57:F59` | Income, Expenses, Net |

Only write values into the data rows. Keep existing formulas and styles.

**Extra Note** is empty by default. The old reports had a remark for every
client ("client is satisfied…"); the new template doesn't. She types a note by
hand only when there is something extra, so never copy the old remarks over.

Known template issues (open questions below):
- `F54` (Package Not Paid) has no formula.
- `F48` uses `SUMPRODUCT(...unique names...)-6`, which is fragile.
- There's no Therapist column.
- Section capacity may overflow on busy days.

### 5. Her monthly Statement of Account (history only)

Sample: `samples/Statement of Account SEP 2026.xlsx`. Two tabs.
- `Statement of Account`: `Period: 1 – 30 September 2026` line, account
  summary, one row per day (Billed, Collected, Expenses, Balance), sessions by
  type, collected by source, expenses by category, insurance sessions by client
  (Client, Therapist, Sessions, Billed), and a **`Package Sessions`** table
  (Client, Package, Used in <month>, Remaining).
- `Active Clients`: client name and therapist(s) for the month.

**Package Sessions "Remaining" is her own count** and is the most trusted
source for how many sessions a package has left at the end of that month. The
go-live seed uses it ahead of schedule session numbers and file counts.

## Domain rules

- **Billing types**: Insurance, Package, Per Session (cash or POS), Free.
- **Package**: bought as N sessions for a total price. Per-session value =
  `round(total / N)`, so 12 for 450 gives 38. Each confirmed attended session
  deducts 1. The schedule's session number (`Name 3 C`) is a cross-check: flag
  it when it disagrees with the app's counter.
- **Insurance approval**: client, insurer, serial number, sessions approved,
  amount billed per session, the client's co-pay per session, and an optional
  validity date. Each attended session deducts 1. The client pays the co-pay
  (appears as `Insurance difference`). The insurer pays the rest later, in lump
  sums. "Insurance Not Paid" = billed − collected.
- **New packages are auto-detected** from cash receipts matching
  `/(package|pkg)\s+of\s+(\d+)/i`. The app proposes the package and she confirms.
- **Cancelled (X)**: not a session by default. Clinic policy says same-day
  cancellations are charged the full fee, so allow her to mark it as charged.
- **Rescheduled (R)**: excluded by default, but shown in review.
- **Payments with no appointment**: add as a row with no therapist, and flag it.
- **Other income** (her decision, 2026-10-16): money in that isn't a client
  session goes to an **Other Income** table in the report, like Expense
  Details: insurer payments, and descriptions with outdoor, commission, tests
  (Bodydot, body composition, InBody). Outdoor sessions count here, not as
  clinic sessions. She can move any cash row between other income and a
  client session. Income = collected + other income; Net = income − expenses.
- **Daily reviews start on 8 October 2026** (`settings.reviews_from`): she made
  the 1–7 October reports by hand, so earlier days aren't listed as "not
  confirmed".
- **Per-client price** (2026-10-17): a per-session client confirmed at a price
  other than the default keeps it (`clients.per_session_price`), and their
  next unpaid session is billed at it. Editable on the client's edit page.
- **Session number corrections** (2026-10-17): typing a package / insurance
  session number in the review re-anchors it on confirm
  (`anchorSession`: sessions already used = N − 1, counted up to the day
  before), so the next session follows from N. Never applied before confirm.
- **Creating from the review**: choosing Package / Insurance for a client
  without one offers "New package…" / "New approval…" in the Edit dialog; it is
  created active, starting at the dialog's session number.
- **Edit this day**: confirming saves the frozen edits (`day_reviews.edits`,
  `frozenEdits`); Edit this day reopens the day with them (older days are
  rebuilt from their sessions, `editsFromSessions`). The report shows package
  and insurance sessions as "7/12", data centred.
- **Package paid status** (2026-10-22): the report's Package table has a
  **Status** column from the package's amount paid vs its price: green "Paid",
  red "$300 due", empty when unknown (`packagePaid`). A later visit with
  nothing collected still shows the package as paid.
- **Cash balance** (2026-10-22): uploads read the cash statement's
  "Balance In $" column (not "Balance IN LBP") into
  `cash_transactions.balance`; balance-only differences are saved quietly for
  the last two months. The report shows "Balance" under Net:
  the balance on the day's last line (`closingBalance`).
- **Name matching**: normalize (trim, lowercase, collapse spaces, strip
  status/number/amount tokens), then exact alias → fuzzy (token-sort ratio ≥ 0.85)
  against known clients → Contacts. Every confirmed match is saved as an alias,
  so it only has to be fixed once.

## Data model (Supabase)

Every table has `id`, `owner_id` (default `auth.uid()`, RLS), `created_at`, and
`updated_at`.

- `clients`: name, phone_contacts (from Contacts), phone_override (her fix),
  phone (generated: override, else Contacts), contacts_key (normalized
  Contacts name, so re-imports update the same client), notes, active
- `client_aliases`: client_id, alias (normalized, unique)
- `packages`: client_id, sessions_total, price_total, per_session, purchased_on,
  source_voucher, sessions_used_before_app (for packages already part-used at
  go-live), used_before_app_as_of (the date that count runs to), status
  (proposed/active/finished/cancelled)
- `insurance_approvals`: client_id, insurer, serial_number, sessions_approved,
  billed_per_session, copay_per_session, approved_on, valid_until,
  sessions_used_before_app, used_before_app_as_of, status
- Views `package_balances` / `approval_balances` (security_invoker): each row
  plus sessions_used_in_app, sessions_used, sessions_remaining, last_session_on.

`proposed` rows come from auto-detection or the seed script and count for
nothing until she accepts them.
- `cash_transactions`: date, name_raw, description, voucher, source_key
  (unique per owner; see "Voucher numbers are recycled"),
  debit, credit, method (cash/pos), pos_amount, kind
  (session/package/insurance_copay/insurer_payment/expense/other), client_id,
  import_id, balance (the statement's running "Balance In $" on that row)
- `schedule_entries`: date, slot_time, therapist, raw_text, parsed_name,
  status, session_no, inline_amount, client_id, import_id
- `day_sessions`: date, client_id, therapist, billing_type, package_id,
  approval_id, session_no, billed, collected, extra_note, confirmed. **This is
  what deductions count from.** Sessions used = count of confirmed rows linked
  to that package or approval.
- `day_reviews`: date (unique), confirmed_at, report_storage_path,
  report_generated_at, expenses and other_income (JSON: the lines and labels she
  confirmed, used by the month file)
- `reminders`: date, slot_time, therapist, client_id, phone_used, sent_at
  (unique on date + slot_time + client_id)
- `imports`: kind (cash/schedule), filename, imported_at, rows_added,
  rows_changed
- `settings`: key → JSON for single values: staff names, default rates,
  reminder message template, sender name, clinic Google Sheet ID(s) per month
- `non_client_patterns`: pattern, match_type (exact/contains)
- `expense_labels`: match_key (`name|description`), label

Sessions remaining is **derived** (total − sessions_used_before_app − confirmed
uses), never stored as a counter, so corrections stay consistent.

### Import rules

- Cash: upsert by `source_key`. A changed amount or name on an existing row
  updates it and is shown in the import summary. Unchanged rows are a no-op.
  Rows that disappear are flagged (`missing_from_source`), not deleted.
- Schedule: replace that date's entries on each import, unless the day is
  already confirmed. In that case show the differences instead.
- Package proposals from cash uploads: only receipts dated after the newest
  receipt already stored (first upload: the last 14 days). Older receipts are
  history that the go-live seed covered; proposing them would flood Today.
- Read every sheet with `sheetRows()` (`src/lib/sheet-rows.ts`): SheetJS
  otherwise starts at the first used cell, which shifts fixed row/column rules
  when a sheet's first rows or columns are empty.

## Phases

Each phase ends with something she can use. Run tests against `samples/`
locally before calling a phase done.

1. **Foundation** *(done 2026-10-15)*: Vite app, hash router, login screen (email + password), and a
   mobile layout with bottom navigation (Today, Schedule, Reminders, Clients,
   More). Screens can be placeholders until their phase. Supabase migrations with RLS on every
   table. GitHub Actions deploy to Pages. *Done when* she can log in on her phone
   and a second test account cannot read her rows.
2. **Packages and insurance** *(built 2026-10-15; go-live seed run pending)*: seed `clients` (with phones) from the Contacts
   tab of an uploaded schedule export. Then build client search, add/edit
   package and add/edit approval, including "sessions already used" for ones
   that started before the app. Dashboard: active packages and approvals with
   sessions left, a low-sessions alert (≤ 1 left), a review list of
   `proposed` items, and client detail with history.
   Go-live seed: a **local, one-time script** (run from the repo against
   `samples/`, never deployed) reads the cash statement and daily reports. It
   inserts open packages, with sessions used so far, as `proposed` for her to
   accept or fix. Insurance approvals can't be fully seeded, because serial
   numbers aren't in any file, so she enters those by hand.
3. **Schedule, reminders and imports** *(built 2026-10-15 on branch `phase-3`, not deployed yet)*. Build in this order:
   (a) **Schedule parser + upload** from the exported xlsx, tested against
   `samples/September 2026.xlsx`. Each import refreshes phones from Contacts.
   (b) **Live Google Sheet read** via Google sign-in. Same parser, different
   input. Do this early: reminders are sent the evening before, from the
   clinic phone, against a schedule physios keep changing, so uploads would
   be stale.
   (c) **Schedule view (read-only)**: day view of the schedule, with
   therapists as columns on desktop and a combined time-ordered list on
   mobile, plus date navigation. Each booking shows status (C/X/R/none) and its
   billing context from the database: package or approval, sessions left, and
   alerts (last session, approval exhausted or expiring, unmatched name). No
   editing; an "Edit in Google Sheets" button opens the live sheet at that
   day's tab. Show when the data was last refreshed.
   (d) **WhatsApp reminders**: a "tomorrow's reminders" queue built from the
   schedule. Match each booking to a client with the normal name matching
   (never by exact cell text), take the phone from `clients`, and open
   `https://wa.me/<digits>?text=<encoded message>`. The message template is
   editable in settings, with placeholders {name}, {weekday}, {date}, {time},
   {sender_name}.
   The default text is the clinic's current reminder (below). Convert slot
   times like `7h30 pm` to `7:30 PM`. Record `sent_at` in `reminders` and show
   sent/unsent state. Flag bookings with no phone or an unconfirmed name match,
   and let her add or fix the phone inline. Skip non-clients and bookings
   already marked X. Never send automatically: one tap opens WhatsApp, she
   presses Send. Replies (C/X/R) are still typed into the Google Sheet by her,
   so the app does not record them.
   (e) **Cash statement upload** with browser decryption, upsert by voucher,
   and an import summary.

   Default reminder text (sent from the clinic's WhatsApp):

   ```
   Hello,
   Your physiotherapy session is scheduled for {weekday} {date} at {time}.

   Please reply with:
   • C to confirm
   • X to cancel
   • R to reschedule

   Note: As per our clinic policy, same-day cancellations are subject to the full session fee.

   Kind regards,
   {sender_name}
   ```

   `{sender_name}` comes from settings. The current text signs with her name
   and the clinic name; keep those in settings, not in the repo.
4. **Daily review and report** *(built 2026-10-15 on branch `phase-4`, not deployed yet; `npm run compare:reports` rebuilds her September/October days: 302 of 316 clients matched, 292 of 302 collected amounts identical; the rest are flagged cases: free sessions not marked on the sheet, spelling variants to link once, no-shows)*: build the day, matching schedule + cash +
   packages/approvals. Flags: unmatched name, paid-but-not-scheduled,
   no-status, package/approval exhausted, session-number mismatch. She edits
   and confirms, then the report is generated from the template, downloaded,
   and saved to Storage. The template is built into the app; Settings can
   upload a replacement to the private bucket.
   The review runs in four steps (`src/components/ReviewSteps.tsx`): Data
   (cash upload + live sheet), Clients (flagged first), Money (expenses,
   other income), Confirm (totals, preview, confirm). It opens on Clients when
   the data is already in.
   **Every report is the month so far** (her decision, 2026-10-16; briefly one
   tab per day on 2026-10-20, reverted 2026-10-22 at her request): one file
   with a tab per confirmed day of the month up to and including that day
   (`monthUpTo` in `src/lib/month-report.ts`), like her old monthly workbooks.
   Preview and Confirm use the draft for that day's tab; a confirmed day's
   download is rebuilt from the saved days, so a corrected earlier day shows
   corrected. There is no separate month download.
   *Done when* rebuilding the September days reproduces the old reports'
   clients and amounts, or every difference is explained.

## Open questions for the admin

Answered 2026-10-15:
- **Free** sessions: a small **Free** table in the report, only on days that have any.
- **Package Not Paid** (F54): the number of package sessions (that day) whose
  package is not fully paid yet.
- **Therapist** column: wanted; add it to each table.
- **Section overflow**: sections are dynamic, as many rows as the day needs
  (no fixed 12/8/10 rows); totals and the summary move with them.
- **Date** goes in **C3**, replacing the "Date:" label: "Date: 15 October 2026".
- **Same-day cancellation (X)** counts for nothing: no session deducted, no charge.
- **Insurance billed per session**: default **$25**, editable per approval.

Still open:
- What exactly is **Serial Number**: the approval number or a per-session claim number?
- Which **insurers** are in use, and what does each pay per session?
- Which Google account opens the clinic sheet on the clinic phone: hers or a clinic account?
