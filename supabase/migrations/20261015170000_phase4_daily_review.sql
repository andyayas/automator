-- Phase 4: daily review and report.

-- How much of a package's price has been paid, for "Package Not Paid".
alter table public.packages add column amount_paid numeric(10, 2) check (amount_paid >= 0);

-- The name shown on the report, kept as it was on the day (names can be edited
-- later; the day's report shouldn't change). Also rows for payers without a
-- client yet.
alter table public.day_sessions add column client_name text;

alter table public.day_reviews add column report_generated_at timestamptz;

-- p.* / a.* in the balance views was expanded when they were created, so they
-- are rebuilt to include the new column.
drop view public.package_balances;
drop view public.approval_balances;

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
