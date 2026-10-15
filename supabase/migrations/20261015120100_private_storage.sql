-- Private bucket for the report template, the logo and saved daily reports.
-- Every object lives under a folder named after its owner's user id:
--   <auth.uid()>/templates/daily-report.xlsx
--   <auth.uid()>/reports/2026-10-15.xlsx

insert into storage.buckets (id, name, public, file_size_limit)
values ('private', 'private', false, 26214400)
on conflict (id) do nothing;

create policy "private bucket: owner can select"
  on storage.objects for select to authenticated
  using (bucket_id = 'private' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "private bucket: owner can insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'private' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "private bucket: owner can update"
  on storage.objects for update to authenticated
  using (bucket_id = 'private' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'private' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "private bucket: owner can delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'private' and (storage.foldername(name))[1] = (select auth.uid())::text);
