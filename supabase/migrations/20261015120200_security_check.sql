-- Reports, for every table in public, whether it is locked down the way
-- CLAUDE.md requires. Used by this migration's assertion and by
-- scripts/rls-check.ts (which also fails if a table has no test fixture).

create or replace function public.table_security_report()
returns table (
  table_name text,
  rls_enabled boolean,
  policy_count integer,
  has_owner_id boolean,
  anon_has_access boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.relname::text,
    c.relrowsecurity,
    (select count(*)::integer from pg_catalog.pg_policies p
      where p.schemaname = 'public' and p.tablename = c.relname),
    exists (select 1 from pg_catalog.pg_attribute a
      where a.attrelid = c.oid and a.attname = 'owner_id' and not a.attisdropped),
    pg_catalog.has_table_privilege('anon', c.oid, 'select, insert, update, delete')
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
  order by 1;
$$;

revoke execute on function public.table_security_report() from public, anon;
grant execute on function public.table_security_report() to authenticated;

-- Fail the migration if any table is not owner-only. Later migrations that add
-- tables should end with this same block.
do $$
declare
  bad text;
begin
  select string_agg(table_name, ', ') into bad
  from public.table_security_report()
  where not rls_enabled or policy_count = 0 or not has_owner_id or anon_has_access;

  if bad is not null then
    raise exception 'Tables not locked to their owner: %', bad;
  end if;
end;
$$;
