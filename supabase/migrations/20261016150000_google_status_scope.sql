-- The connection status also says which Google permissions were granted, so
-- the app can tell when creating next month's sheet needs one more consent.
-- Still never returns the token.
drop function if exists public.google_connection_status();

create function public.google_connection_status()
returns table (google_email text, connected_at timestamptz, scope text)
language sql
stable
security definer
set search_path = ''
as $$
  select g.google_email, g.updated_at, g.scope
  from private.google_connections g
  where g.owner_id = auth.uid();
$$;

revoke execute on function public.google_connection_status() from public, anon;
grant execute on function public.google_connection_status() to authenticated;
