-- Phase 2: Contacts import key, "sessions already used" as-of dates,
-- derived balances, and a cash key that works with recycled voucher numbers.

-- Which Contacts row a client came from (normalized Contacts name), so a
-- re-import updates that client instead of adding a duplicate.
alter table public.clients add column contacts_key text;
alter table public.clients add constraint clients_owner_contacts_key_key unique (owner_id, contacts_key);

-- "Sessions already used" counts sessions up to and including this date.
alter table public.packages add column used_before_app_as_of date;
alter table public.insurance_approvals add column used_before_app_as_of date;

-- Receipt books restart (rc1..rc100), so the same voucher number appears in
-- several months. Rows are identified by a key the importer builds instead:
-- date + voucher, or a content key for rows without a voucher.
alter table public.cash_transactions drop constraint cash_transactions_owner_id_voucher_key;
alter table public.cash_transactions add column source_key text not null;
alter table public.cash_transactions add constraint cash_transactions_owner_source_key_key unique (owner_id, source_key);
create index cash_transactions_voucher_idx on public.cash_transactions (owner_id, voucher);

-- ---------------------------------------------------------------------------
-- Balances. Never stored: total - used before the app - confirmed uses.
-- security_invoker makes the views run with the caller's RLS.
-- ---------------------------------------------------------------------------

create view public.package_balances with (security_invoker = true) as
select
  p.*,
  coalesce(u.used, 0) as sessions_used_in_app,
  p.sessions_used_before_app + coalesce(u.used, 0) as sessions_used,
  p.sessions_total - p.sessions_used_before_app - coalesce(u.used, 0) as sessions_remaining,
  u.last_session_on
from public.packages p
left join lateral (
  select count(*)::integer as used, max(d.date) as last_session_on
  from public.day_sessions d
  where d.package_id = p.id and d.confirmed
) u on true;

create view public.approval_balances with (security_invoker = true) as
select
  a.*,
  coalesce(u.used, 0) as sessions_used_in_app,
  a.sessions_used_before_app + coalesce(u.used, 0) as sessions_used,
  a.sessions_approved - a.sessions_used_before_app - coalesce(u.used, 0) as sessions_remaining,
  u.last_session_on
from public.insurance_approvals a
left join lateral (
  select count(*)::integer as used, max(d.date) as last_session_on
  from public.day_sessions d
  where d.approval_id = a.id and d.confirmed
) u on true;

revoke all on public.package_balances, public.approval_balances from anon;
grant select on public.package_balances, public.approval_balances to authenticated;

-- ---------------------------------------------------------------------------
-- Security report now covers views too: they must use security_invoker.
-- ---------------------------------------------------------------------------

drop function public.table_security_report();

create function public.table_security_report()
returns table (
  table_name text,
  kind text,
  rls_enabled boolean,
  policy_count integer,
  has_owner_id boolean,
  security_invoker boolean,
  anon_has_access boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.relname::text,
    case c.relkind when 'v' then 'view' else 'table' end,
    c.relrowsecurity,
    (select count(*)::integer from pg_catalog.pg_policies p
      where p.schemaname = 'public' and p.tablename = c.relname),
    exists (select 1 from pg_catalog.pg_attribute a
      where a.attrelid = c.oid and a.attname = 'owner_id' and not a.attisdropped),
    exists (select 1 from unnest(coalesce(c.reloptions, '{}')) o
      where lower(o) in ('security_invoker=true', 'security_invoker=on', 'security_invoker=1')),
    pg_catalog.has_table_privilege('anon', c.oid, 'select, insert, update, delete')
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
  order by 1;
$$;

revoke execute on function public.table_security_report() from public, anon;
grant execute on function public.table_security_report() to authenticated;

-- Fail the migration if any table or view is not owner-only.
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
