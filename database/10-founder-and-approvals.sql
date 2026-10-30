-- =====================================================================
-- Buffalo Machines Staff Hub: founder role, private leave, container
-- check-in approvals (run once, after files 01-09)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to run more than once. Does not delete any stock, invoices or leave.
--
-- Roles after this:
--   founder  - everything managers can do, PLUS: add/edit/delete models and
--              accessories (incl. prices), add containers, delete machines,
--              delete history (activity log, invoices), company details.
--   manager  - approve leave, add events, leave allowances, final approval
--              of container check-ins, reassign/delete others' tasks.
--   staff    - invoices, stock entries, own leave requests, waiting list,
--              tasks, and SUBMIT container check-ins (a manager approves).
-- Staff can only see their OWN leave. Managers/founder see everyone's.
--
-- To make yourself founder, run separately (with your login email):
--   update public.profiles set role = 'founder' where email = 'you@example.com';
-- =====================================================================

-- ---------- 1. FOUNDER ROLE ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('staff', 'manager', 'founder'));

-- Founders count as managers everywhere a manager is allowed.
create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('manager', 'founder'));
$$;

create or replace function public.is_founder()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'founder');
$$;

-- ---------- 2. MODELS, ACCESSORIES AND PRICES: FOUNDER ONLY ----------
drop policy if exists "manager adds models"    on public.models;
drop policy if exists "manager edits models"   on public.models;
drop policy if exists "manager deletes models" on public.models;
drop policy if exists "founder adds models"    on public.models;
drop policy if exists "founder edits models"   on public.models;
drop policy if exists "founder deletes models" on public.models;
create policy "founder adds models"    on public.models for insert to authenticated with check (public.is_founder());
create policy "founder edits models"   on public.models for update to authenticated using (public.is_founder()) with check (public.is_founder());
create policy "founder deletes models" on public.models for delete to authenticated using (public.is_founder());

-- ---------- 3. MACHINES: founder adds (containers) and deletes; managers edit ----------
drop policy if exists "manager adds machines"    on public.machines;
drop policy if exists "manager deletes machines" on public.machines;
drop policy if exists "founder adds machines"    on public.machines;
drop policy if exists "founder deletes machines" on public.machines;
create policy "founder adds machines"    on public.machines for insert to authenticated with check (public.is_founder());
create policy "founder deletes machines" on public.machines for delete to authenticated using (public.is_founder());
-- ("manager edits machines" stays: managers and founder can edit details / mark arrived.)

-- ---------- 4. HISTORY: only the founder can delete ----------
drop policy if exists "manager deletes invoices" on public.invoices;
drop policy if exists "founder deletes invoices" on public.invoices;
create policy "founder deletes invoices" on public.invoices for delete to authenticated using (public.is_founder());

drop policy if exists "founder deletes history" on public.audit_log;
create policy "founder deletes history" on public.audit_log for delete to authenticated using (public.is_founder());

-- ---------- 5. COMPANY DETAILS: FOUNDER ONLY ----------
drop policy if exists "manager edits company settings" on public.company_settings;
drop policy if exists "founder edits company settings" on public.company_settings;
create policy "founder edits company settings" on public.company_settings for update to authenticated
  using (public.is_founder()) with check (public.is_founder());

-- ---------- 6. LEAVE IS PRIVATE ----------
drop policy if exists "staff read holidays" on public.holidays;
drop policy if exists "own leave or manager reads" on public.holidays;
create policy "own leave or manager reads" on public.holidays for select to authenticated
  using (staff_id = auth.uid() or public.is_manager());

-- The activity log also records leave, so hide those rows from staff too.
drop policy if exists "staff read audit log" on public.audit_log;
drop policy if exists "staff read audit log (not leave)" on public.audit_log;
create policy "staff read audit log (not leave)" on public.audit_log for select to authenticated
  using (table_name <> 'holidays' or public.is_manager());

-- ---------- 7. CONTAINER CHECK-INS: staff submit, a manager approves ----------
create table if not exists public.container_checkins (
  id            uuid primary key default gen_random_uuid(),
  container_ref text not null,
  arrive_ids    uuid[] not null default '{}',   -- en-route machines that arrived
  remove_ids    uuid[] not null default '{}',   -- short items to remove as missing
  extras        jsonb  not null default '[]',   -- [{model_id, size, qty}] not on the list
  location      text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_by  uuid references public.profiles(id) default auth.uid(),
  submitted_at  timestamptz not null default now(),
  decided_by    uuid references public.profiles(id),
  decided_at    timestamptz
);
create index if not exists container_checkins_status_idx on public.container_checkins (status);

alter table public.container_checkins enable row level security;
drop policy if exists "staff read checkins"      on public.container_checkins;
drop policy if exists "staff submit checkins"    on public.container_checkins;
drop policy if exists "manager decides checkins" on public.container_checkins;
drop policy if exists "founder deletes checkins" on public.container_checkins;
create policy "staff read checkins"   on public.container_checkins for select to authenticated using (true);
create policy "staff submit checkins" on public.container_checkins for insert to authenticated
  with check (submitted_by = auth.uid() and status = 'pending');
create policy "manager decides checkins" on public.container_checkins for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy "founder deletes checkins" on public.container_checkins for delete to authenticated using (public.is_founder());

-- Approving does all the stock changes in one go, recorded under the approver's name.
create or replace function public.approve_container_checkin(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.container_checkins;
  e jsonb;
begin
  if not public.is_manager() then
    raise exception 'Only a manager can approve a container check-in.';
  end if;
  select * into c from public.container_checkins where id = p_id for update;
  if not found or c.status <> 'pending' then
    raise exception 'This check-in has already been dealt with.';
  end if;

  update public.machines
     set status = 'in_stock', location = coalesce(c.location, location)
   where id = any (c.arrive_ids) and status = 'en_route' and container_ref = c.container_ref;

  delete from public.machines
   where id = any (c.remove_ids) and status = 'en_route' and container_ref = c.container_ref;

  for e in select * from jsonb_array_elements(c.extras) loop
    insert into public.machines (model_id, size, status, container_ref, location, notes)
    select (e->>'model_id')::uuid, nullif(e->>'size', ''), 'in_stock', c.container_ref, c.location,
           'Extra: not on the original container list'
      from generate_series(1, greatest(1, least(500, (e->>'qty')::int)));
  end loop;

  update public.container_checkins set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = p_id;
end $$;

revoke all on function public.approve_container_checkin(uuid) from public, anon;
grant execute on function public.approve_container_checkin(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'container_checkins') then
    alter publication supabase_realtime add table public.container_checkins;
  end if;
end $$;
