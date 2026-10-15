-- Merge a duplicate client into the one she keeps, in one transaction.
-- security invoker: runs with her own permissions, so RLS limits it to her rows.

create or replace function public.merge_clients(keep_id uuid, remove_id uuid, remove_alias text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  keep public.clients;
  dup public.clients;
begin
  if keep_id = remove_id then
    raise exception 'Pick two different clients.';
  end if;
  select * into keep from public.clients where id = keep_id;
  select * into dup from public.clients where id = remove_id;
  if keep.id is null or dup.id is null then
    raise exception 'Client not found.';
  end if;

  update public.packages set client_id = keep_id where client_id = remove_id;
  update public.insurance_approvals set client_id = keep_id where client_id = remove_id;
  update public.day_sessions set client_id = keep_id where client_id = remove_id;
  update public.schedule_entries set client_id = keep_id where client_id = remove_id;
  update public.cash_transactions set client_id = keep_id where client_id = remove_id;

  -- A reminder already logged for the kept client in the same slot wins.
  delete from public.reminders r
  where r.client_id = remove_id
    and exists (
      select 1 from public.reminders k
      where k.client_id = keep_id and k.date = r.date and k.slot_time = r.slot_time
    );
  update public.reminders set client_id = keep_id where client_id = remove_id;

  update public.client_aliases set client_id = keep_id where client_id = remove_id;
  -- The duplicate's name becomes a spelling of the kept client.
  if remove_alias is not null and remove_alias <> '' then
    insert into public.client_aliases (client_id, alias)
    values (keep_id, remove_alias)
    on conflict (owner_id, alias) do update set client_id = excluded.client_id;
  end if;

  -- The duplicate's Contacts entry and phone move over where the kept one has none.
  update public.clients set contacts_key = null where id = remove_id;
  update public.clients
  set
    contacts_key = coalesce(keep.contacts_key, dup.contacts_key),
    phone_contacts = coalesce(keep.phone_contacts, dup.phone_contacts),
    phone_override = coalesce(keep.phone_override, dup.phone_override),
    notes = nullif(concat_ws(E'\n', keep.notes, dup.notes), '')
  where id = keep_id;

  delete from public.clients where id = remove_id;
end;
$$;

revoke execute on function public.merge_clients(uuid, uuid, text) from public, anon;
grant execute on function public.merge_clients(uuid, uuid, text) to authenticated;
