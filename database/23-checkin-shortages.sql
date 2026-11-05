-- =====================================================================
-- Buffalo Machines Staff Hub: record what didn't arrive at check-in (run once)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
--
-- What it does:
--   Adds one column, container_checkins.short, so every container check-in
--   records what was missing: which items, how many, and whether they were
--   removed as missing or kept as still on the way. The Machines history
--   shows it in red under each arrival, so shortages can be raised with the
--   factory. Check-ins made before this only show items removed as missing.
--
-- What it does NOT do:
--   No policies or other tables change. Approving works exactly as before.
--
-- Safe to run more than once.
-- =====================================================================

alter table public.container_checkins add column if not exists short jsonb not null default '[]'::jsonb;  -- [{model_id, size, qty, kept}]
