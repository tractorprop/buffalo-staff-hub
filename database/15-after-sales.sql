-- =====================================================================
-- Buffalo Machines Staff Hub: After-sales queries (run once)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
--
-- What it does:
--   Adds one table, aftersales, for logging after-sales queries that come in
--   on the after-sales WhatsApp number. Each query has an invoice number
--   (required), the machine, a short description of the issue, who it's
--   flagged to, urgent yes/no, a status and a list of updates.
--   Statuses: waiting (waiting for response, red; every query starts here),
--   diagnosing (amber),
--   resolved (green).
--   * All signed-in staff can see, log and update queries.
--   * Only managers and the founder can delete a query.
--   NO customer names or phone numbers are stored: the chat stays in WhatsApp.
--
-- What it does NOT do:
--   It changes no existing table, policy or trigger.
--
-- Safe to run more than once.
-- =====================================================================

create table if not exists public.aftersales (
  id           bigint generated always as identity primary key,
  invoice_ref  text not null check (length(trim(invoice_ref)) between 1 and 60),
  model_id     uuid references public.models (id) on delete set null,
  issue        text not null check (length(trim(issue)) between 1 and 1000),
  assignee_id  uuid references public.profiles (id) on delete set null,
  urgent       boolean not null default false,
  status       text not null default 'waiting' check (status in ('waiting', 'diagnosing', 'resolved')),
  updates      jsonb not null default '[]'::jsonb,   -- [{at, by, text}]
  created_by   uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

drop trigger if exists aftersales_touch on public.aftersales;
create trigger aftersales_touch before update on public.aftersales
  for each row execute function public.touch_updated_at();

alter table public.aftersales enable row level security;

drop policy if exists "staff read aftersales"       on public.aftersales;
drop policy if exists "staff log aftersales"        on public.aftersales;
drop policy if exists "staff update aftersales"     on public.aftersales;
drop policy if exists "manager deletes aftersales"  on public.aftersales;
create policy "staff read aftersales"      on public.aftersales for select to authenticated using (true);
create policy "staff log aftersales"       on public.aftersales for insert to authenticated with check (created_by = auth.uid());
create policy "staff update aftersales"    on public.aftersales for update to authenticated using (true) with check (true);
create policy "manager deletes aftersales" on public.aftersales for delete to authenticated using (public.is_manager());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'aftersales') then
    alter publication supabase_realtime add table public.aftersales;
  end if;
end $$;
