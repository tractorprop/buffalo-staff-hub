-- =====================================================================
-- Buffalo Machines Staff Hub: annual leave allowances (run once)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to run more than once. Does not delete or change any existing data.
--
-- What it adds:
--   leave_allowances: how many annual leave days each person gets per year.
--   PRIVATE: staff can read only their OWN allowance; managers can read and
--   set everyone's. Nobody else can see another person's allowance.
--   (Deliberately NOT recorded in the activity log, because every staff
--   member can read the activity log.)
-- =====================================================================

create table if not exists public.leave_allowances (
  staff_id   uuid not null references public.profiles(id) on delete cascade,
  year       int  not null check (year between 2000 and 2100),
  days       numeric(5,1) not null check (days >= 0 and days <= 366),
  updated_at timestamptz not null default now(),
  primary key (staff_id, year)
);

alter table public.leave_allowances enable row level security;

drop policy if exists "own allowance or manager reads"  on public.leave_allowances;
drop policy if exists "manager adds allowance"          on public.leave_allowances;
drop policy if exists "manager edits allowance"         on public.leave_allowances;
drop policy if exists "manager deletes allowance"       on public.leave_allowances;
create policy "own allowance or manager reads" on public.leave_allowances for select to authenticated
  using (staff_id = auth.uid() or public.is_manager());
create policy "manager adds allowance" on public.leave_allowances for insert to authenticated
  with check (public.is_manager());
create policy "manager edits allowance" on public.leave_allowances for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy "manager deletes allowance" on public.leave_allowances for delete to authenticated
  using (public.is_manager());

drop trigger if exists leave_allowances_touch on public.leave_allowances;
create trigger leave_allowances_touch before update on public.leave_allowances
  for each row execute function public.touch_updated_at();

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leave_allowances') then
    alter publication supabase_realtime add table public.leave_allowances;
  end if;
end $$;
