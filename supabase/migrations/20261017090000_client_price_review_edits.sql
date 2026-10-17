-- A client's usual per-session price (learned when she confirms a day at a
-- price other than the default), and the edits behind each confirmed day, so
-- "Edit this day" reopens it exactly as she confirmed it.

alter table public.clients
  add column per_session_price numeric(10, 2) check (per_session_price is null or per_session_price >= 0);

comment on column public.clients.per_session_price is
  'Usual per-session price when it differs from the default; learned from confirmed days, editable.';

alter table public.day_reviews add column edits jsonb;

comment on column public.day_reviews.edits is
  'Her review edits (rows, removed, restored, added, labels, income moves) at confirmation, restored by Edit this day.';

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
