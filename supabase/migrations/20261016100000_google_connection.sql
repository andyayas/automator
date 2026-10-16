-- Google connection for reading the clinic sheet without a popup every hour.
--
-- The Google refresh token is a long-lived credential, so it lives outside the
-- API-exposed `public` schema: no role a browser can hold (anon, authenticated)
-- can read it, not even its owner. Only the `google-token` Edge Function
-- (service role) reaches it, through the functions below.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table private.google_connections (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  google_email text,
  refresh_token text not null,
  scope text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private.google_connections enable row level security;
revoke all on private.google_connections from public, anon, authenticated;
grant select, insert, update, delete on private.google_connections to service_role;

-- Called by the Edge Function only (service role), with the caller's user id
-- taken from their verified login.
create function public.google_connection_get(p_owner uuid)
returns table (google_email text, refresh_token text, scope text)
language sql
stable
security definer
set search_path = ''
as $$
  select g.google_email, g.refresh_token, g.scope
  from private.google_connections g
  where g.owner_id = p_owner;
$$;

create function public.google_connection_save(p_owner uuid, p_email text, p_refresh_token text, p_scope text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.google_connections (owner_id, google_email, refresh_token, scope)
  values (p_owner, p_email, p_refresh_token, p_scope)
  on conflict (owner_id) do update
    set google_email = excluded.google_email,
        refresh_token = excluded.refresh_token,
        scope = excluded.scope,
        updated_at = now();
$$;

create function public.google_connection_delete(p_owner uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.google_connections where owner_id = p_owner;
$$;

-- Her own login may see whether Google is connected and as whom, never the token.
create function public.google_connection_status()
returns table (google_email text, connected_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select g.google_email, g.updated_at
  from private.google_connections g
  where g.owner_id = auth.uid();
$$;

revoke execute on function public.google_connection_get(uuid) from public, anon, authenticated;
revoke execute on function public.google_connection_save(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.google_connection_delete(uuid) from public, anon, authenticated;
grant execute on function public.google_connection_get(uuid) to service_role;
grant execute on function public.google_connection_save(uuid, text, text, text) to service_role;
grant execute on function public.google_connection_delete(uuid) to service_role;
revoke execute on function public.google_connection_status() from public, anon;
grant execute on function public.google_connection_status() to authenticated;

-- Fail the migration if the token became reachable from a browser role.
do $$
begin
  if has_table_privilege('authenticated', 'private.google_connections', 'select')
    or has_table_privilege('anon', 'private.google_connections', 'select')
    or has_function_privilege('authenticated', 'public.google_connection_get(uuid)', 'execute')
    or has_function_privilege('anon', 'public.google_connection_get(uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.google_connection_save(uuid, text, text, text)', 'execute')
    or has_function_privilege('authenticated', 'public.google_connection_delete(uuid)', 'execute')
  then
    raise exception 'Google refresh tokens are reachable from a browser role';
  end if;
end;
$$;

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
