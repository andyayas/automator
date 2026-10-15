-- Phase 3: schedule import details and reminder support.

-- How each booking's name was matched to a client, so the app can ask her to
-- confirm uncertain matches (fuzzy) and link unknown names (none).
alter table public.schedule_entries
  add column name_key text,
  add column match_kind text check (match_kind in ('alias', 'exact', 'fuzzy', 'none')),
  add column cell_ref text,
  add column sheet_tab text;

create index schedule_entries_name_key_idx on public.schedule_entries (owner_id, name_key);

-- Wish Money and similar transfers are neither cash in the drawer nor POS.
alter table public.cash_transactions drop constraint cash_transactions_method_check;
alter table public.cash_transactions
  add constraint cash_transactions_method_check check (method in ('cash', 'pos', 'transfer'));

-- Same safety check as every migration.
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
