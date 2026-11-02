-- =====================================================================
-- Buffalo Machines Staff Hub: factory invoice on production orders (run once)
-- Run 18-production-orders.sql first.
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
--
-- What it does:
--   * Creates a PRIVATE file store ("stock-documents", max 20 MB per file,
--     PDF / pictures / Excel / Word only) for the factory invoice.
--   * Adds one table, stock_documents: which file belongs to which production
--     order and, once shipped, which container.
--   * ONLY THE FOUNDER can see, open, upload or delete these files and rows.
--     Managers and staff can't even see that a document exists.
--   The hub deletes the file once the container has fully arrived (the next
--   time the founder opens the Machines page), so storage stays small.
--
-- What it does NOT do:
--   It changes no existing table or permission.
--
-- Safe to run more than once.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stock-documents', 'stock-documents', false, 20971520, array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "founder reads stock documents"   on storage.objects;
drop policy if exists "founder uploads stock documents" on storage.objects;
drop policy if exists "founder changes stock documents" on storage.objects;
drop policy if exists "founder deletes stock documents" on storage.objects;
create policy "founder reads stock documents"   on storage.objects for select to authenticated using (bucket_id = 'stock-documents' and public.is_founder());
create policy "founder uploads stock documents" on storage.objects for insert to authenticated with check (bucket_id = 'stock-documents' and public.is_founder());
create policy "founder changes stock documents" on storage.objects for update to authenticated using (bucket_id = 'stock-documents' and public.is_founder());
create policy "founder deletes stock documents" on storage.objects for delete to authenticated using (bucket_id = 'stock-documents' and public.is_founder());

create table if not exists public.stock_documents (
  id             uuid primary key default gen_random_uuid(),
  production_id  uuid references public.production_orders (id) on delete set null,  -- empty once fully shipped
  container_ref  text,                                                              -- set when shipped
  path           text not null,      -- where the file is in the private store
  name           text not null,      -- the file's original name
  uploaded_at    timestamptz not null default now()
);

alter table public.stock_documents enable row level security;
drop policy if exists "founder only stock documents" on public.stock_documents;
create policy "founder only stock documents" on public.stock_documents for all to authenticated
  using (public.is_founder()) with check (public.is_founder());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stock_documents') then
    alter publication supabase_realtime add table public.stock_documents;
  end if;
end $$;
