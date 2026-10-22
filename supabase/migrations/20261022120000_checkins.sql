-- Check-in messages: clients who haven't been back for 30 days get a "how are
-- you feeling?" WhatsApp. One row per client and last visit, once she sends or
-- skips it, so the same visit never comes up twice. A new visit makes the
-- client due again 30 days later.

create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id uuid not null,
  last_visit date not null,
  status text not null check (status in ('sent', 'skipped')),
  phone_used text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, client_id, last_visit),
  -- Merging a duplicate client deletes it; its check-ins go with it.
  foreign key (client_id, owner_id) references public.clients (id, owner_id) on delete cascade
);

alter table public.checkins enable row level security;
create policy "owner can select" on public.checkins for select to authenticated using (owner_id = (select auth.uid()));
create policy "owner can insert" on public.checkins for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "owner can update" on public.checkins for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "owner can delete" on public.checkins for delete to authenticated using (owner_id = (select auth.uid()));
revoke all on public.checkins from anon;
grant select, insert, update, delete on public.checkins to authenticated;
create index checkins_owner_idx on public.checkins (owner_id);
create index checkins_client_idx on public.checkins (client_id);
create trigger set_updated_at before update on public.checkins for each row execute function public.set_updated_at();

-- Same assertion as the latest earlier migrations: every public table and view is owner-only.
do $$
declare
  bad text;
begin
  select string_agg(table_name, ', ') into bad
  from public.table_security_report()
  where anon_has_access
     or not has_owner_id
     or (kind = 'table' and (not rls_enabled or policy_count = 0))
     or (kind = 'view' and not security_invoker);
  if bad is not null then
    raise exception 'Tables or views not locked to their owner: %', bad;
  end if;
end;
$$;
