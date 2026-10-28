-- =====================================================================
-- Buffalo Machines Staff Hub: calendar events and low-stock levels (run once)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to run more than once. Does not delete or change any existing data.
--
-- What it adds:
--   1. models.reorder_level: the "low stock" level for each model. The
--      dashboard warns when a model's In stock count is at or below it.
--      Empty = no warning. Only managers can set it (existing models rules).
--   2. events: company events shown on the calendar. Everyone signed in can
--      see them; only managers can add, edit or delete them. Changes are
--      recorded in the activity log.
--   3. Managers can add holidays for any staff member, already approved
--      (e.g. leave agreed in person). Staff can still only request their own,
--      as "pending".
-- =====================================================================

-- ---------- 1. LOW STOCK LEVEL PER MODEL ----------
alter table public.models
  add column if not exists reorder_level int check (reorder_level is null or reorder_level >= 0);

-- ---------- 2. CALENDAR EVENTS ----------
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  start_date  date not null,
  end_date    date not null,
  note        text,
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  check (end_date >= start_date)
);

alter table public.events enable row level security;

drop policy if exists "staff read events"      on public.events;
drop policy if exists "manager adds events"    on public.events;
drop policy if exists "manager edits events"   on public.events;
drop policy if exists "manager deletes events" on public.events;
create policy "staff read events"      on public.events for select to authenticated using (true);
create policy "manager adds events"    on public.events for insert to authenticated with check (public.is_manager());
create policy "manager edits events"   on public.events for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "manager deletes events" on public.events for delete to authenticated using (public.is_manager());

drop trigger if exists events_audit on public.events;
create trigger events_audit after insert or update or delete on public.events
  for each row execute function public.log_change();

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events') then
    alter publication supabase_realtime add table public.events;
  end if;
end $$;

-- ---------- 3. MANAGERS CAN ADD HOLIDAYS FOR ANYONE ----------
drop policy if exists "manager adds holidays" on public.holidays;
create policy "manager adds holidays" on public.holidays for insert to authenticated
  with check (public.is_manager());

-- =====================================================================
-- NOTE: do not re-run 01-setup.sql from now on. It deletes and recreates the
-- data tables, which would wipe your stock, customers, tasks and holidays.
-- =====================================================================
