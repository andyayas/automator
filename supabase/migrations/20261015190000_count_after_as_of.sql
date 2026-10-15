-- "Sessions already used" counts sessions up to and including
-- used_before_app_as_of. Confirmed days on or before that date (e.g. days
-- before go-live, reviewed later for their report) must not be counted again,
-- so the balances only count confirmed sessions after it.

create or replace view public.package_balances with (security_invoker = true) as
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
  where d.package_id = p.id
    and d.confirmed
    and (p.used_before_app_as_of is null or d.date > p.used_before_app_as_of)
) u on true;

create or replace view public.approval_balances with (security_invoker = true) as
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
  where d.approval_id = a.id
    and d.confirmed
    and (a.used_before_app_as_of is null or d.date > a.used_before_app_as_of)
) u on true;

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
