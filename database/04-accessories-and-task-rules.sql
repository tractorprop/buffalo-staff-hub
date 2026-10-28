-- =====================================================================
-- Buffalo Machines Staff Hub: accessories and task rules (run once)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to run more than once. Does not delete or change any existing data.
--
-- What it adds:
--   1. Accessories. Each entry in "models" is now either a machine or an
--      accessory (models.kind). An accessory lists the machine models it fits
--      (models.fits_models). Accessories are stocked exactly like machines:
--      containers, stock entry, low stock and the waiting list all work.
--   2. Task rules, enforced by the database:
--      * A task assigned to someone can only be marked completed (or
--        reopened) by that person. Unassigned tasks: anyone.
--      * Only managers can reassign a task that belongs to someone else.
--      * Only managers can delete someone else's task. Staff can delete
--        their own tasks and unassigned ones.
--      Changes made directly in the Supabase dashboard are not restricted.
-- =====================================================================

-- ---------- 1. ACCESSORIES ----------
alter table public.models
  add column if not exists kind text not null default 'machine' check (kind in ('machine', 'accessory'));
alter table public.models
  add column if not exists fits_models uuid[] not null default '{}';

-- ---------- 2. TASK RULES ----------
create or replace function public.check_task_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if auth.uid() is null then
    return new; -- changed in the Supabase dashboard
  end if;
  if old.assignee_id is not null and old.assignee_id <> auth.uid() then
    if new.done is distinct from old.done then
      select coalesce(full_name, email) into v_name from profiles where id = old.assignee_id;
      raise exception 'Only % can mark this task as completed.', coalesce(v_name, 'the person it is assigned to');
    end if;
    if new.assignee_id is distinct from old.assignee_id and not public.is_manager() then
      raise exception 'Only a manager can reassign a task that belongs to someone else.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tasks_check_change on public.tasks;
create trigger tasks_check_change before update on public.tasks
  for each row execute function public.check_task_change();

-- Replace the single "staff manage tasks" rule with separate ones.
drop policy if exists "staff manage tasks"  on public.tasks;
drop policy if exists "staff read tasks"    on public.tasks;
drop policy if exists "staff add tasks"     on public.tasks;
drop policy if exists "staff update tasks"  on public.tasks;
drop policy if exists "delete own, unassigned, or manager" on public.tasks;
create policy "staff read tasks"   on public.tasks for select to authenticated using (true);
create policy "staff add tasks"    on public.tasks for insert to authenticated with check (true);
create policy "staff update tasks" on public.tasks for update to authenticated using (true) with check (true);
create policy "delete own, unassigned, or manager" on public.tasks for delete to authenticated
  using (public.is_manager() or assignee_id is null or assignee_id = auth.uid());
