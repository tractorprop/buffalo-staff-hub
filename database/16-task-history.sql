-- =====================================================================
-- Buffalo Machines Staff Hub: task history (run once)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
--
-- What it does:
--   * Records every task change in the activity log (who assigned a task to
--     whom, who completed or reopened it and when, reassignments, deletions),
--     using the same log_change() function as machines and the waiting list.
--   * Changes who can READ the activity log: task history is now hidden from
--     staff, like leave already is. Managers and the founder see it all.
--
-- What it does NOT do:
--   It changes no tables and no other permissions. Task history starts from
--   the moment this is run (older tasks still show, without the details).
--
-- Safe to run more than once.
-- =====================================================================

drop trigger if exists tasks_audit on public.tasks;
create trigger tasks_audit after insert or update or delete on public.tasks
  for each row execute function public.log_change();

drop policy if exists "staff read audit log (not leave)" on public.audit_log;
drop policy if exists "staff read audit log (not leave or tasks)" on public.audit_log;
create policy "staff read audit log (not leave or tasks)" on public.audit_log for select to authenticated
  using (table_name not in ('holidays', 'tasks') or public.is_manager());
