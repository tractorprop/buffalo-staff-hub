-- =====================================================================
-- Buffalo Machines Staff Hub: deposits on the waiting list (run once)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
--
-- What it does:
--   Adds four columns to the waiting list so staff can record that a
--   customer has paid a deposit on a machine that hasn't arrived yet:
--     deposit_paid (yes/no), deposit_amount (£, optional),
--     deposit_date, deposit_by (who recorded it).
--   Existing customers are unchanged (no deposit). The existing rules apply:
--   all staff can add and update waiting customers; changes are recorded in
--   the activity log as before.
--
-- What it does NOT do:
--   No policies or other tables change. Card or bank details are NOT stored.
--
-- Safe to run more than once.
-- =====================================================================

alter table public.waitlist add column if not exists deposit_paid   boolean not null default false;
alter table public.waitlist add column if not exists deposit_amount numeric(10, 2) check (deposit_amount is null or deposit_amount >= 0);
alter table public.waitlist add column if not exists deposit_date   date;
alter table public.waitlist add column if not exists deposit_by     uuid references public.profiles (id) on delete set null;
