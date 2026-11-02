-- =====================================================================
-- Buffalo Machines Staff Hub: history is for managers and the founder (run once)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
--
-- What it does:
--   Changes who can READ the activity log (history):
--   * Staff can only read stock history (machines), which the Stock entry
--     page needs for its history list.
--   * Managers and the founder can read everything, as before.
--   Replaces the rule from 16-task-history.sql (which hid only leave and tasks).
--
-- What it does NOT do:
--   Nothing is deleted and no other permissions change.
--
-- Safe to run more than once.
-- =====================================================================

drop policy if exists "staff read audit log"                       on public.audit_log;
drop policy if exists "staff read audit log (not leave)"           on public.audit_log;
drop policy if exists "staff read audit log (not leave or tasks)"  on public.audit_log;
drop policy if exists "staff read stock history, managers read all" on public.audit_log;
create policy "staff read stock history, managers read all" on public.audit_log for select to authenticated
  using (table_name = 'machines' or public.is_manager());
