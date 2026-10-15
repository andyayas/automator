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
- [ ] GitHub Pages source = GitHub Actions (try `gh api` first).
- [ ] GitHub Actions variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
      (try `gh variable set` first).

## Principles

1. **Each fact is entered once, where other people already look for it.**
   Physiotherapists keep booking in the clinic's Google Sheet and logging money in
   the cash statement Excel file. The admin keeps doing the same. This app
   **reads** those sources and never asks her to retype what is already in them.
2. **The app only stores what exists nowhere else**: package purchases, insurance
   approvals, name aliases, phone fixes, reminder send log, and her
   confirmations of each day.
3. **Read-only toward clinic files.** Never write to, re-share, publish or
   restructure the Google Sheet or the cash statement.
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

## Security (non-negotiable)

- **No real data in the repo, ever.** Real sample files live in `samples/`, which
  is gitignored. Test fixtures that must be committed are synthetic, with invented
  names. Don't paste real client names into code, comments, tests, commit messages
  or this file.
- **No clinic-identifying assets in the repo.** The report template and logo live
  in a **private Supabase Storage bucket** and are downloaded at runtime.
- **The Supabase anon / publishable key is public by design.** Row-level security is what
  protects data. Every table gets RLS enabled, with an `owner_id uuid default
  auth.uid()` column and policies `using (owner_id = auth.uid())` /
  `with check (owner_id = auth.uid())`. No table without RLS. Public sign-ups are
  disabled in the Supabase dashboard, so she is the only user.
- **The cash statement password is never stored in code or in the bundle.** She
  types it at upload. Optionally it is remembered in her own browser's
  localStorage behind a "remember on this device" checkbox. Vite inlines every
  `VITE_*` env var into the public bundle, so the password must never be a
  `VITE_` variable. For local tests it is `SAMPLE_CASH_PASSWORD` in `.env.local`,
  read only by test code.
- **The cash statement file never leaves the device.** Decrypt and parse in the
  browser, then send only the parsed transaction rows to Supabase.
- Add an **"Export all data"** button (JSON + CSV download) as her own backup.

## Data sources

### 1. Appointment schedule (Google Sheet, read-only)

Sample: `samples/September 2026.xlsx` (an export of the live sheet).

- One tab per working day, named like `Tue 22 SEP` (`%a %-d %b`, month uppercase).
  Sundays are skipped and some Saturdays too. A new spreadsheet or tab set exists
  per month.
- `I1` holds the date.
- Row 3: therapist names in **B, D, F** (read them, don't hardcode).
- Rows 4–33: half-hour slots, `A4` = `7h00 am` … `A33` = `10h00 pm`.
- Columns **C, E, G** are WhatsApp-reminder formulas. Ignore them.
- Row 34 `Total Hrs of Sessions`; row 36 `Notes`.
- A `Contacts` tab: column A name, column B phone (~3,000 rows). Use it as the
  base client list, for fuzzy matching, and for reminder phone numbers. Phones
  are stored as numbers that may read back as floats (`9613001272.0`). Convert
  them to digit strings with no `+`, as `wa.me` expects. Most already start
  with 961; add it when missing.
  Contacts is re-read on each schedule import. Phone fixes she makes in the app
  win over Contacts.
- Columns C/E/G currently build WhatsApp links with `REGEXEXTRACT` and an exact
  `VLOOKUP` against Contacts. They fail (`#N/A`) whenever the cell has a status
  letter, a session number, two names or a spelling variant. The app replaces
  this for her with proper name matching. Leave the sheet's links alone for
  everyone else.

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
- Row 3 headers. Row 6 holds the brought-forward balance in **J**.
- From row 7, the columns are:
  - **D** Date, filled on the first row of each day only (carry it down)
  - **E** Name (client, vendor, or insurer)
  - **F** Description
  - **G** Voucher (`rc…` = receipt in, `pv…` = payment out)
  - **H** Debit $ (money in)
  - **I** Credit $ (money out)
  - **J** Running balance formula
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

- Client table at `A12:F53`: Client Name, Therapist, Info, Amount Paid, Amount
  Billed, Notes. Info is mostly `Insurance`, `Package`, `Cash`, `Free`, or
  `POS 45$`.
- Expenses at `H12:I21`.
- Reconciliation at `H23:I27`, where Opening = previous day's `I27`.

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

Known template issues (open questions below):
- `F54` (Package Not Paid) has no formula.
- `F48` uses `SUMPRODUCT(...unique names...)-6`, which is fragile.
- There's no Therapist column.
- Section capacity may overflow on busy days.

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
- **Name matching**: normalize (trim, lowercase, collapse spaces, strip
  status/number/amount tokens), then exact alias → fuzzy (token-sort ratio ≥ 0.85)
  against known clients → Contacts. Every confirmed match is saved as an alias,
  so it only has to be fixed once.

## Data model (Supabase)

Every table has `id`, `owner_id` (default `auth.uid()`, RLS), `created_at`, and
`updated_at`.

- `clients`: name, phone, notes, active
- `client_aliases`: client_id, alias (normalized, unique)
- `packages`: client_id, sessions_total, price_total, per_session, purchased_on,
  source_voucher, sessions_used_before_app (for packages already part-used at
  go-live), status (proposed/active/finished/cancelled)
- `insurance_approvals`: client_id, insurer, serial_number, sessions_approved,
  billed_per_session, copay_per_session, approved_on, valid_until,
  sessions_used_before_app, status (proposed/active/finished/cancelled)

`proposed` rows come from auto-detection or the seed script and count for
nothing until she accepts them.
- `cash_transactions`: date, name_raw, description, voucher (unique per owner),
  debit, credit, method (cash/pos), pos_amount, kind
  (session/package/insurance_copay/insurer_payment/expense/other), client_id,
  import_id
- `schedule_entries`: date, slot_time, therapist, raw_text, parsed_name,
  status, session_no, inline_amount, client_id, import_id
- `day_sessions`: date, client_id, therapist, billing_type, package_id,
  approval_id, session_no, billed, collected, extra_note, confirmed. **This is
  what deductions count from.** Sessions used = count of confirmed rows linked
  to that package or approval.
- `day_reviews`: date (unique), confirmed_at, report_storage_path
- `reminders`: date, slot_time, therapist, client_id, phone_used, sent_at
  (unique on date + slot_time + client_id)
- `imports`: kind (cash/schedule), filename, imported_at, rows_added,
  rows_changed
- `settings`: staff names, non-client patterns, expense label mappings,
  default rates, reminder message template, clinic Google Sheet ID(s) per month

Sessions remaining is **derived** (total − sessions_used_before_app − confirmed
uses), never stored as a counter, so corrections stay consistent.

### Import rules

- Cash: upsert by `voucher`. A changed amount or name on an existing voucher
  updates the row and is shown in the import summary. Unchanged rows are a
  no-op. Vouchers that disappear are flagged, not deleted.
- Schedule: replace that date's entries on each import, unless the day is
  already confirmed. In that case show the differences instead.

## Phases

Each phase ends with something she can use. Run tests against `samples/`
locally before calling a phase done.

1. **Foundation**: Vite app, hash router, login screen (email + password), and a
   mobile layout with bottom navigation (Today, Schedule, Clients, Reminders,
   More). Screens can be placeholders until their phase. Supabase migrations with RLS on every
   table. GitHub Actions deploy to Pages. *Done when* she can log in on her phone
   and a second test account cannot read her rows.
2. **Packages and insurance**: seed `clients` (with phones) from the Contacts
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
3. **Schedule, reminders and imports**. Build in this order:
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
4. **Daily review and report**: build the day, matching schedule + cash +
   packages/approvals. Flags: unmatched name, paid-but-not-scheduled,
   no-status, package/approval exhausted, session-number mismatch. She edits
   and confirms, then the report is generated from the template, downloaded,
   and saved to Storage. Settings gets an upload for the template file, which
   goes to the private bucket; it holds the logo, so nothing clinic-specific
   ships with the app.
   *Done when* rebuilding the September days reproduces the old reports'
   clients and amounts, or every difference is explained.

## Open questions for the admin

- Where do **Free** sessions go in the new template?
- What exactly is **Serial Number**: the approval number or a per-session claim
  number?
- What formula should **Package Not Paid** (F54) use?
- Is dropping the **Therapist** column intended?
- What happens when a section overflows its rows?
- Does the date go in `D3`?
- Should a same-day cancellation count against a package or approval?
- Which insurers are in use, and what does each pay per session?
- Which Google account opens the clinic sheet on the clinic phone: hers or a
  clinic account? Live reading needs an account with at least view access.
