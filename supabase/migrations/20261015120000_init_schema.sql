-- Phase 1 schema. Every table belongs to one owner (the admin) and is locked
-- to that owner with row-level security, set up at the end of this file.
--
-- Cross-table references use composite foreign keys on (id, owner_id), so a row
-- can only point at rows with the same owner, even though FK checks bypass RLS.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  -- Phone from the Contacts tab, refreshed on each schedule import.
  phone_contacts text check (phone_contacts ~ '^[0-9]{6,15}$'),
  -- Phone fix she made in the app; always wins over Contacts.
  phone_override text check (phone_override ~ '^[0-9]{6,15}$'),
  phone text generated always as (coalesce(phone_override, phone_contacts)) stored,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.client_aliases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id uuid not null,
  -- Normalized form (trimmed, lowercased, spaces collapsed) produced by the app.
  alias text not null check (alias <> '' and alias = lower(btrim(alias))),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, alias),
  foreign key (client_id, owner_id) references public.clients (id, owner_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Packages and insurance approvals
-- Sessions remaining is derived, never stored:
--   total - sessions_used_before_app - confirmed day_sessions linked to it.
-- 'proposed' rows count for nothing until she accepts them.
-- ---------------------------------------------------------------------------

create table public.packages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id uuid not null,
  sessions_total integer not null check (sessions_total > 0),
  price_total numeric(10, 2) not null check (price_total >= 0),
  per_session numeric(10, 2) not null check (per_session >= 0),
  purchased_on date,
  source_voucher text,
  sessions_used_before_app integer not null default 0,
  status text not null default 'proposed'
    check (status in ('proposed', 'active', 'finished', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  check (sessions_used_before_app between 0 and sessions_total),
  foreign key (client_id, owner_id) references public.clients (id, owner_id)
);

create table public.insurance_approvals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id uuid not null,
  insurer text not null check (btrim(insurer) <> ''),
  serial_number text,
  sessions_approved integer not null check (sessions_approved > 0),
  billed_per_session numeric(10, 2) not null check (billed_per_session >= 0),
  copay_per_session numeric(10, 2) not null default 0 check (copay_per_session >= 0),
  approved_on date,
  valid_until date,
  sessions_used_before_app integer not null default 0,
  status text not null default 'proposed'
    check (status in ('proposed', 'active', 'finished', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  check (sessions_used_before_app between 0 and sessions_approved),
  check (valid_until is null or approved_on is null or valid_until >= approved_on),
  foreign key (client_id, owner_id) references public.clients (id, owner_id)
);

-- ---------------------------------------------------------------------------
-- Imports from the clinic's files (read-only toward the files themselves)
-- ---------------------------------------------------------------------------

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('cash', 'schedule')),
  filename text,
  imported_at timestamptz not null default now(),
  rows_added integer not null default 0 check (rows_added >= 0),
  rows_changed integer not null default 0 check (rows_changed >= 0),
  -- Import summary: changed vouchers, vouchers missing from the file, etc.
  details jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  name_raw text,
  description text,
  voucher text,
  debit numeric(12, 2),
  credit numeric(12, 2),
  method text not null default 'cash' check (method in ('cash', 'pos')),
  pos_amount numeric(12, 2),
  kind text not null default 'other'
    check (kind in ('session', 'package', 'insurance_copay', 'insurer_payment', 'expense', 'other')),
  client_id uuid,
  import_id uuid,
  source_sheet text,
  source_row integer,
  -- Set when a later upload no longer contains this voucher (flagged, never deleted).
  missing_from_source boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, voucher),
  foreign key (client_id, owner_id) references public.clients (id, owner_id)
    on delete set null (client_id),
  foreign key (import_id, owner_id) references public.imports (id, owner_id)
    on delete set null (import_id)
);

create index cash_transactions_date_idx on public.cash_transactions (owner_id, date);

create table public.schedule_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  slot_time time not null,
  therapist text not null,
  raw_text text not null,
  parsed_name text,
  status text not null default 'unknown'
    check (status in ('confirmed', 'cancelled', 'rescheduled', 'unknown')),
  session_no integer check (session_no > 0),
  inline_amount numeric(10, 2),
  -- Billing type written inline in the cell ("Insurance", "Free").
  billing_note text,
  is_non_client boolean not null default false,
  client_id uuid,
  import_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (client_id, owner_id) references public.clients (id, owner_id)
    on delete set null (client_id),
  foreign key (import_id, owner_id) references public.imports (id, owner_id)
    on delete set null (import_id)
);

create index schedule_entries_date_idx on public.schedule_entries (owner_id, date);

-- ---------------------------------------------------------------------------
-- Daily review. Deductions count only from confirmed day_sessions rows.
-- ---------------------------------------------------------------------------

create table public.day_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  client_id uuid,
  therapist text,
  billing_type text not null check (billing_type in ('insurance', 'package', 'per_session', 'free')),
  payment_method text check (payment_method in ('cash', 'pos')),
  package_id uuid,
  approval_id uuid,
  schedule_entry_id uuid,
  cash_transaction_id uuid,
  session_no integer check (session_no > 0),
  billed numeric(10, 2) not null default 0,
  collected numeric(10, 2) not null default 0,
  extra_note text,
  confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (package_id is null or billing_type = 'package'),
  check (approval_id is null or billing_type = 'insurance'),
  foreign key (client_id, owner_id) references public.clients (id, owner_id),
  foreign key (package_id, owner_id) references public.packages (id, owner_id),
  foreign key (approval_id, owner_id) references public.insurance_approvals (id, owner_id),
  foreign key (schedule_entry_id, owner_id) references public.schedule_entries (id, owner_id)
    on delete set null (schedule_entry_id),
  foreign key (cash_transaction_id, owner_id) references public.cash_transactions (id, owner_id)
    on delete set null (cash_transaction_id)
);

create index day_sessions_date_idx on public.day_sessions (owner_id, date);
create index day_sessions_package_idx on public.day_sessions (package_id) where package_id is not null;
create index day_sessions_approval_idx on public.day_sessions (approval_id) where approval_id is not null;

create table public.day_reviews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  confirmed_at timestamptz,
  report_storage_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, date)
);

-- ---------------------------------------------------------------------------
-- WhatsApp reminder send log
-- ---------------------------------------------------------------------------

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  slot_time time not null,
  therapist text,
  client_id uuid not null,
  phone_used text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, date, slot_time, client_id),
  foreign key (client_id, owner_id) references public.clients (id, owner_id)
);

-- ---------------------------------------------------------------------------
-- Settings
-- Single values (reminder template, sender name, default rates, sheet IDs,
-- staff names) are key -> JSON. The two lists she edits row by row and the app
-- learns from get their own tables.
-- ---------------------------------------------------------------------------

create table public.settings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, key)
);

create table public.non_client_patterns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  pattern text not null check (pattern <> '' and pattern = lower(btrim(pattern))),
  match_type text not null check (match_type in ('exact', 'contains')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, match_type, pattern)
);

create table public.expense_labels (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- "name|description", lowercased and trimmed.
  match_key text not null check (match_key <> '' and match_key = lower(btrim(match_key))),
  label text not null check (btrim(label) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, match_key)
);

-- ---------------------------------------------------------------------------
-- Row-level security: owner-only, on every table.
-- anon gets no table privileges at all; authenticated gets CRUD filtered by RLS.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'clients', 'client_aliases', 'packages', 'insurance_approvals', 'imports',
    'cash_transactions', 'schedule_entries', 'day_sessions', 'day_reviews',
    'reminders', 'settings', 'non_client_patterns', 'expense_labels'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    execute format(
      'create policy "owner can select" on public.%I for select to authenticated '
      'using (owner_id = (select auth.uid()))', t);
    execute format(
      'create policy "owner can insert" on public.%I for insert to authenticated '
      'with check (owner_id = (select auth.uid()))', t);
    execute format(
      'create policy "owner can update" on public.%I for update to authenticated '
      'using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
    execute format(
      'create policy "owner can delete" on public.%I for delete to authenticated '
      'using (owner_id = (select auth.uid()))', t);

    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    execute format('create index %I on public.%I (owner_id)', t || '_owner_idx', t);
    execute format(
      'create trigger set_updated_at before update on public.%I '
      'for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;

-- Tables created by later migrations must not be readable by anon by default.
alter default privileges in schema public revoke all on tables from anon;
