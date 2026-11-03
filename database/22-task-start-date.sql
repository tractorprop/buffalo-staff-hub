-- =====================================================================
-- Buffalo Machines Staff Hub: start date on tasks (run once)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
--
-- What it does:
--   Adds one column, tasks.start_date, so a task can have a start date as
--   well as a due date. Staff then see "To do now" (start date reached) and
--   "Starting later" on the Tasks page. Existing tasks have no start date,
--   so they count as "to do now".
--
-- What it does NOT do:
--   No policies, triggers or other tables change.
--
-- Safe to run more than once.
-- =====================================================================

alter table public.tasks add column if not exists start_date date;
