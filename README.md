# Clinic Admin Assistant

A personal admin tool for a small clinic: daily report, client packages and
insurance approvals, schedule context, and WhatsApp appointment reminders.
Single user. See [CLAUDE.md](CLAUDE.md) for the full spec.

Live: https://andyayas.github.io/automator/

## Stack

Vite + React + TypeScript on GitHub Pages, Supabase (Postgres, Auth, Storage)
with row-level security on every table.

## Development

```sh
cp .env.example .env.local   # fill in the values
npm install                  # also enables the pre-commit hook
npm run dev                  # http://localhost:5173/automator/
npm test
npm run build
```

Database changes are migrations in `supabase/migrations/`, applied with
`supabase db push --linked`. After any schema change, run `npm run check:rls`:
it signs in as two test users and proves neither can read, change or delete
the other's rows or files.

## Data safety

No real clinic data is ever committed. `samples/`, spreadsheets and env files
are gitignored, and both the pre-commit hook and CI refuse them. The Supabase
anon key in the bundle is public by design; access is controlled by RLS.
