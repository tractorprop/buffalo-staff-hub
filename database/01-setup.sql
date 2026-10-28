-- =====================================================================
-- Buffalo Machines Staff Hub: database setup (version 2)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
--
-- Works on a brand-new project, AND on one where version 1 was already run.
-- Staff logins and profiles (names, manager roles) are always kept.
--
-- WARNING: this REPLACES the data tables (models, machines, waiting list,
-- tasks, holidays, activity log). If you ran version 1 and already typed in
-- real stock, customers, tasks or holidays, those will be emptied.
-- If you have real data, STOP and ask before running.
-- =====================================================================

-- ---------- 0. CLEAR OUT ANY EARLIER VERSION OF THE DATA TABLES ----------
drop view  if exists public.model_stock_summary;
drop table if exists public.audit_log cascade;
drop table if exists public.holidays  cascade;
drop table if exists public.tasks     cascade;
drop table if exists public.waitlist  cascade;
drop table if exists public.machines  cascade;
drop table if exists public.models    cascade;
drop function if exists public.notify_restock()      cascade;
drop function if exists public.check_machine_size()  cascade;
drop function if exists public.log_change()          cascade;

-- ---------- 1. STAFF PROFILES (kept if they already exist) ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  email      text,
  role       text not null default 'staff' check (role in ('staff','manager')),
  created_at timestamptz not null default now()
);

-- Automatically create a profile whenever a staff login is added.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Create profiles for any logins that already exist.
insert into public.profiles (id, email, full_name)
select id, email, coalesce(raw_user_meta_data->>'full_name', split_part(email,'@',1))
from auth.users
on conflict (id) do nothing;

-- Helper: is the signed-in person a manager?
create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'manager');
$$;

-- ---------- 2. MODEL CATALOGUE ----------
-- One row per model you sell. Set up once; only managers can change it.
-- "sizes" is a list, for example {Small,Medium,Large}. Leave empty if the model has one size.
create table public.models (
  id           uuid primary key default gen_random_uuid(),
  model_number text not null,
  name         text,
  sizes        text[] not null default '{}',
  notes        text,
  created_at   timestamptz not null default now()
);
create unique index models_model_number_uidx on public.models (lower(model_number));

-- ---------- 3. MACHINES (stock) ----------
-- One row per individual machine. Status: in_stock, en_route (in a container), sold.
create table public.machines (
  id            uuid primary key default gen_random_uuid(),
  model_id      uuid not null references public.models(id) on delete restrict,
  size          text,                  -- required only for models that have sizes
  serial_number text,
  status        text not null default 'in_stock' check (status in ('in_stock','en_route','sold')),
  container_ref text,                  -- shipping container / booking reference
  eta           date,                  -- expected arrival when en_route
  location      text,
  sold_date     date,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index machines_model_idx  on public.machines (model_id);
create index machines_status_idx on public.machines (status);

-- Check the size matches the model's available sizes.
create or replace function public.check_machine_size()
returns trigger language plpgsql as $$
declare s text[];
begin
  select sizes into s from public.models where id = new.model_id;
  if coalesce(array_length(s,1),0) > 0 then
    if new.size is null or not (new.size = any(s)) then
      raise exception 'Size must be one of: %', array_to_string(s, ', ');
    end if;
  else
    new.size := null;
  end if;
  return new;
end $$;

create trigger machines_a_check_size before insert or update on public.machines
  for each row execute function public.check_machine_size();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger machines_b_touch before update on public.machines
  for each row execute function public.touch_updated_at();

-- ---------- 4. WAITING LIST ----------
-- Customers who want a model we do not have. Matching is by MODEL only.
create table public.waitlist (
  id            uuid primary key default gen_random_uuid(),
  customer_name text not null,
  phone         text,
  email         text,
  model_id      uuid not null references public.models(id) on delete restrict,
  size_wanted   text,                  -- optional, for information only (not used for alerts)
  notes         text,
  contacted     boolean not null default false,
  contacted_by  uuid references public.profiles(id),
  contacted_at  timestamptz,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now()
);
create index waitlist_model_idx on public.waitlist (model_id);

-- ---------- 5. TASKS ----------
create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  assignee_id   uuid references public.profiles(id),
  due_date      date,
  priority      text not null default 'Normal' check (priority in ('Low','Normal','High')),
  done          boolean not null default false,
  related_model text,                  -- model number, set automatically for restock call tasks
  created_at    timestamptz not null default now()
);

-- ---------- 6. HOLIDAYS ----------
create table public.holidays (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.profiles(id) default auth.uid(),
  start_date  date not null,
  end_date    date not null check (end_date >= start_date),
  type        text not null default 'Annual leave' check (type in ('Annual leave','Sick','Unpaid','Other')),
  note        text,
  status      text not null default 'pending' check (status in ('pending','approved','declined')),
  created_at  timestamptz not null default now()
);

-- ---------- 7. RESTOCK ALERT ----------
-- When a machine becomes "in_stock" and customers are waiting for that MODEL,
-- automatically create one High-priority "call customers" task.
create or replace function public.notify_restock()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int; m text;
begin
  if new.status = 'in_stock' and (tg_op = 'INSERT' or old.status is distinct from 'in_stock') then
    select count(*) into n from public.waitlist
      where model_id = new.model_id and contacted = false;
    if n > 0 then
      select model_number into m from public.models where id = new.model_id;
      if not exists (select 1 from public.tasks where done = false and related_model = m) then
        insert into public.tasks (title, priority, due_date, related_model)
        values (format('Call %s waiting customer(s): %s is back in stock', n, m),
                'High', current_date, m);
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger machines_c_restock_alert
  after insert or update of status on public.machines
  for each row execute function public.notify_restock();

-- ---------- 8. ACTIVITY LOG ----------
-- Records who added, changed or deleted models, machines, waiting-list entries and holidays.
-- Staff can read it; nobody can edit or delete entries (only the triggers write to it).
create table public.audit_log (
  id         bigint generated always as identity primary key,
  table_name text not null,
  record_id  uuid,
  action     text not null,            -- INSERT, UPDATE, DELETE
  changed_by uuid default auth.uid(),
  old_data   jsonb,
  new_data   jsonb,
  changed_at timestamptz not null default now()
);
create index audit_log_table_idx on public.audit_log (table_name, changed_at desc);

create or replace function public.log_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (table_name, record_id, action, changed_by, old_data, new_data)
  values (
    tg_table_name,
    ((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'id')::uuid,
    tg_op,
    auth.uid(),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger models_audit    after insert or update or delete on public.models
  for each row execute function public.log_change();
create trigger machines_audit  after insert or update or delete on public.machines
  for each row execute function public.log_change();
create trigger waitlist_audit  after insert or update or delete on public.waitlist
  for each row execute function public.log_change();
create trigger holidays_audit  after insert or update or delete on public.holidays
  for each row execute function public.log_change();

-- ---------- 9. STOCK SUMMARY PER MODEL (for the dashboard) ----------
create view public.model_stock_summary with (security_invoker = true) as
select
  m.id           as model_id,
  m.model_number,
  m.name,
  m.sizes,
  count(distinct ma.id) filter (where ma.status = 'in_stock') as in_stock,
  count(distinct ma.id) filter (where ma.status = 'en_route') as en_route,
  count(distinct ma.id) filter (where ma.status = 'sold')     as sold,
  count(distinct w.id)  filter (where w.contacted = false)    as waiting
from public.models m
left join public.machines ma on ma.model_id = m.id
left join public.waitlist w  on w.model_id  = m.id
group by m.id;

-- ---------- 10. SECURITY (Row Level Security) ----------
alter table public.profiles  enable row level security;
alter table public.models    enable row level security;
alter table public.machines  enable row level security;
alter table public.waitlist  enable row level security;
alter table public.tasks     enable row level security;
alter table public.holidays  enable row level security;
alter table public.audit_log enable row level security;

-- Only signed-in staff can see anything. Nothing is open to the public.
drop policy if exists "staff read profiles" on public.profiles;
create policy "staff read profiles" on public.profiles for select to authenticated using (true);

-- Models and machines: everyone signed in can VIEW; only managers can add, edit or delete.
create policy "staff read models"      on public.models   for select to authenticated using (true);
create policy "manager adds models"    on public.models   for insert to authenticated with check (public.is_manager());
create policy "manager edits models"   on public.models   for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "manager deletes models" on public.models   for delete to authenticated using (public.is_manager());

create policy "staff read machines"      on public.machines for select to authenticated using (true);
create policy "manager adds machines"    on public.machines for insert to authenticated with check (public.is_manager());
create policy "manager edits machines"   on public.machines for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "manager deletes machines" on public.machines for delete to authenticated using (public.is_manager());

-- Waiting list: all staff can view, add enquiries and mark customers contacted.
-- Only managers can delete entries.
create policy "staff read waitlist"      on public.waitlist for select to authenticated using (true);
create policy "staff add waitlist"       on public.waitlist for insert to authenticated with check (true);
create policy "staff update waitlist"    on public.waitlist for update to authenticated using (true) with check (true);
create policy "manager deletes waitlist" on public.waitlist for delete to authenticated using (public.is_manager());

-- Tasks: all staff.
create policy "staff manage tasks" on public.tasks for all to authenticated using (true) with check (true);

-- Holidays: everyone can see the calendar; staff request their own;
-- only managers approve/decline; staff can cancel their own pending requests.
create policy "staff read holidays" on public.holidays for select to authenticated using (true);
create policy "staff request own holidays" on public.holidays for insert to authenticated
  with check (staff_id = auth.uid() and status = 'pending');
create policy "manager decides holidays" on public.holidays for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy "cancel own pending or manager deletes" on public.holidays for delete to authenticated
  using (public.is_manager() or (staff_id = auth.uid() and status = 'pending'));

-- Activity log: staff can read. No one can write directly.
create policy "staff read audit log" on public.audit_log for select to authenticated using (true);

-- ---------- 11. LIVE UPDATES ----------
alter publication supabase_realtime add table
  public.models, public.machines, public.waitlist, public.tasks, public.holidays;

-- =====================================================================
-- AFTER RUNNING THIS FILE (do these in the Supabase dashboard):
--  1. Authentication > Sign In / Providers > turn OFF "Allow new users to sign up".
--  2. Authentication > Users > Add user > "Create new user" for each of your 7 staff
--     (type a password and tick "Auto Confirm User"; do NOT use "Invite").
--  3. Make your managers (run with their real emails):
--       update public.profiles set role = 'manager'
--       where email in ('first.manager@example.com', 'second.manager@example.com');
--  4. Add your models in the app (managers only), or in bulk:
--       Table Editor > models > Insert > Import data from CSV
--       (columns: model_number, name, sizes; write sizes like {Small,Medium,Large}).
-- =====================================================================
